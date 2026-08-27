// server/modules/kanban/attachments.ts
//
// Task attachment storage: files live under `<data>/uploads/tasks/<taskId>/`,
// metadata rows live in the local SQLite `task_attachments` table (created by
// the task store). Transfers use base64 JSON bodies so no multipart parser
// dependency is needed; hard caps keep requests small (8 MB binary each).

import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

import { getConnection } from '@/modules/database/index.js';

import type { TaskAttachment } from './types.js';

const MAX_BINARY_BYTES = 8 * 1024 * 1024;
const MAX_FILES_PER_TASK = 10;

export interface TaskAttachmentRow extends TaskAttachment {}

/** Absolute upload root. Deterministic so tests can override. */
function uploadsRoot(): string {
  const base = process.env.PLANRLA_DATA_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.planrla');
  return path.join(base, 'uploads', 'tasks');
}

function sanitizeFilename(raw: string): string {
  const base = path.basename(String(raw ?? 'file')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return (base || 'attachment').slice(0, 120);
}

interface Row {
  id: string; task_id: string; filename: string;
  stored_path: string; size: number; created_at: string;
}

function rowToMeta(r: Row): TaskAttachment {
  return { id: r.id, taskId: r.task_id, filename: r.filename, storedPath: r.stored_path, size: r.size, createdAt: r.created_at };
}

export function createAttachmentStore() {
  const db = getConnection();

  function taskDir(taskId: string): string {
    return path.join(uploadsRoot(), taskId);
  }

  function assertTaskExists(taskId: string): void {
    const row = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!row) throw Object.assign(new Error('task not found'), { statusCode: 404, code: 'TASK_NOT_FOUND' });
  }

  function countFor(taskId: string): number {
    return (db.prepare('SELECT COUNT(*) c FROM task_attachments WHERE task_id = ?').get(taskId) as { c: number } | undefined)?.c ?? 0;
  }

  function add(taskId: string, filenameRaw: string, dataB64: string): TaskAttachment {
    assertTaskExists(taskId);
    if (countFor(taskId) >= MAX_FILES_PER_TASK) {
      throw Object.assign(new Error(`最多 ${MAX_FILES_PER_TASK} 个附件`), { statusCode: 400, code: 'TOO_MANY_ATTACHMENTS' });
    }
    const buf = Buffer.from(dataB64 ?? '', 'base64');
    if (!buf.length) throw Object.assign(new Error('empty file'), { statusCode: 400, code: 'EMPTY_FILE' });
    if (buf.length > MAX_BINARY_BYTES) {
      throw Object.assign(new Error('单个附件最大 8MB'), { statusCode: 400, code: 'FILE_TOO_LARGE' });
    }

    const dir = taskDir(taskId);
    fsSync.mkdirSync(dir, { recursive: true });

    // Keep multiple same-name files: prefix short uuid, keep original name after first dash.
    const safe = sanitizeFilename(filenameRaw);
    const storedName = `${randomUUID().slice(0, 8)}-${safe}`;
    const abs = path.join(dir, storedName);
    // Defense-in-depth: resolved path must stay inside the task dir.
    if (!path.resolve(abs).startsWith(path.resolve(dir) + path.sep)) {
      throw Object.assign(new Error('invalid filename'), { statusCode: 400, code: 'INVALID_FILENAME' });
    }
    fsSync.writeFileSync(abs, buf);

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO task_attachments (id, task_id, filename, stored_path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, taskId, safe, abs, buf.length, now);

    return { id, taskId, filename: safe, storedPath: abs, size: buf.length, createdAt: now };
  }

  function list(taskId: string): TaskAttachment[] {
    const rows = db.prepare('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Row[];
    return rows.map(rowToMeta);
  }

  /** Row lookup + containment check for downloads. */
  function resolveDownloadable(taskId: string, attachmentId: string): { meta: TaskAttachment; abs: string } | null {
    const row = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId) as Row | undefined;
    if (!row) return null;
    const abs = path.resolve(row.stored_path);
    if (!abs.startsWith(path.resolve(taskDir(taskId)) + path.sep)) return null;
    if (!fsSync.existsSync(abs)) return null;
    return { meta: rowToMeta(row), abs };
  }

  function remove(taskId: string, attachmentId: string): boolean {
    const row = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId) as Row | undefined;
    if (!row) return false;
    try { if (fsSync.existsSync(row.stored_path)) fsSync.rmSync(row.stored_path); } catch { /* best-effort */ }
    const r = db.prepare('DELETE FROM task_attachments WHERE id = ? AND task_id = ?').run(attachmentId, taskId);
    return r.changes > 0;
  }

  /** Per-task counts keyed by task id — board badge feed.
   *  rootId null/''/'all' = global board aggregation (all tasks). */
  function countsByTask(rootId: string | null | undefined): Record<string, number> {
    const scoped = rootId && rootId !== 'all' ? rootId : null;
    const rows = scoped
      ? db.prepare(
        `SELECT ta.task_id AS tid, COUNT(*) c
         FROM task_attachments ta JOIN tasks t ON t.id = ta.task_id
         WHERE t.root_id = ? GROUP BY ta.task_id`,
      ).all(scoped) as Array<{ tid: string; c: number }>
      : db.prepare(
        `SELECT task_id AS tid, COUNT(*) c FROM task_attachments GROUP BY task_id`,
      ).all() as Array<{ tid: string; c: number }>;
    return Object.fromEntries(rows.map((r) => [r.tid, r.c]));
  }

  return { add, list, resolveDownloadable, remove, countsByTask };
}
