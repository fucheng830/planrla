// server/modules/sync/tasks-adapter.ts
//
// Bridges the local kanban `tasks` table and the cloud `shared_tasks` payload.
//
// serialize(): local task → portable payload (runtime-only fields stripped).
// deserialize(): cloud task row → local upsert (task_number recomputed, LWW).
//
// Runtime-only fields that MUST NOT be synced (they are meaningless on another
// machine): worktree_path, worktree_branch, worktree_root_id, scheduler_admitted,
// main_session_key, provider_session_id, aux_*, pending_ask_user, task_number,
// current_stage_index, create_worktree, task_template_*.

import type { Database as DB } from 'better-sqlite3';

/** The portable, machine-independent slice of a task. */
export type PortableTaskPayload = {
  status: string;
  priority: string;
  labels: string[];
  dependencies: string[];
  taskType?: 'feature' | 'bug';
  title?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type SerializedTask = {
  id: string;
  root_id: string;
  payload: PortableTaskPayload;
  updated_at: number; // epoch ms — LWW clock
  deleted?: boolean;
};

type TaskRow = {
  id: string;
  task_number: number;
  root_id: string;
  status: string;
  labels_json: string;
  priority: string | null;
  dependencies_json: string | null;
  task_type: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/**
 * Reads tasks whose updated_at is newer than `sinceMs` (epoch ms) and returns
 * them in the portable wire format. Returns at most `limit` rows (newest first).
 */
export function serializeChangedTasks(db: DB, sinceMs: number, limit = 500): SerializedTask[] {
  const rows = db.prepare(
    `SELECT id, task_number, root_id, status, labels_json, priority, dependencies_json,
            task_type, created_at, updated_at, completed_at
     FROM tasks
     WHERE strftime('%s', updated_at) * 1000 > ?
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).all(sinceMs, limit) as TaskRow[];

  return rows.map(rowToSerialized);
}

function rowToSerialized(r: TaskRow): SerializedTask {
  return {
    id: r.id,
    root_id: r.root_id,
    updated_at: Date.parse(r.updated_at) || Date.now(),
    payload: {
      status: r.status,
      priority: r.priority ?? 'medium',
      labels: safeParseArray(r.labels_json),
      dependencies: safeParseArray(r.dependencies_json),
      taskType: r.task_type === 'bug' ? 'bug' : 'feature',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    },
  };
}

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A cloud task row (deserialized from the pull response). */
export type CloudTask = {
  id: string;
  root_id: string;
  author_instance?: string;
  author_user?: string;
  payload: PortableTaskPayload | unknown;
  updated_at: number;
  deleted: boolean;
};

/**
 * Applies a batch of cloud tasks to the local DB. For each row:
 *   - deleted → hard-delete locally (if present) + clear its tombstone.
 *   - alive → upsert with LWW (skip if local updated_at >= cloud updated_at),
 *     recomputing task_number locally. Fields we don't know (template/worktree)
 *     get neutral defaults so the row is valid.
 *
 * Returns the counts of applied/skipped/deleted for status reporting.
 */
export function applyCloudTasks(db: DB, tasks: CloudTask[]): { applied: number; skipped: number; deleted: number } {
  let applied = 0;
  let skipped = 0;
  let deleted = 0;

  const tx = db.transaction(() => {
    for (const t of tasks) {
      if (t.deleted) {
        const local = db.prepare('SELECT id FROM tasks WHERE id = ?').get(t.id);
        if (local) {
          db.prepare('DELETE FROM task_events WHERE task_id = ?').run(t.id);
          db.prepare('DELETE FROM stage_runs WHERE task_id = ?').run(t.id);
          db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
          deleted += 1;
        }
        db.prepare('DELETE FROM task_tombstones WHERE task_id = ?').run(t.id);
        continue;
      }

      const payload = normalizePayload(t.payload);
      const cloudUpdatedMs = t.updated_at;
      const local = db.prepare('SELECT updated_at FROM tasks WHERE id = ?').get(t.id) as { updated_at: string } | undefined;
      if (local) {
        const localMs = Date.parse(local.updated_at) || 0;
        if (localMs >= cloudUpdatedMs) { skipped += 1; continue; }
        // LWW: cloud wins — update portable fields only, leave runtime fields alone.
        db.prepare(
          `UPDATE tasks SET status = ?, priority = ?, labels_json = ?, dependencies_json = ?,
                            task_type = ?, completed_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          payload.status,
          payload.priority,
          JSON.stringify(payload.labels),
          JSON.stringify(payload.dependencies),
          payload.taskType,
          payload.completedAt ?? null,
          payload.updatedAt,
          t.id,
        );
        applied += 1;
      } else {
        // New task from a teammate. task_number is recomputed locally.
        const nextNum = nextTaskNumber(db, t.root_id);
        db.prepare(
          `INSERT INTO tasks
            (id, task_number, root_id, task_template_id, task_template_name, create_worktree,
             current_stage_index, status, scheduler_admitted, labels_json, priority,
             dependencies_json, task_type, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, '', NULL, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          t.id,
          nextNum,
          t.root_id,
          payload.status,
          JSON.stringify(payload.labels),
          payload.priority,
          JSON.stringify(payload.dependencies),
          payload.taskType,
          payload.createdAt,
          payload.updatedAt,
          payload.completedAt ?? null,
        );
        applied += 1;
      }
    }
  });

  tx();
  return { applied, skipped, deleted };
}

function nextTaskNumber(db: DB, rootId: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(task_number), 0) + 1 AS next FROM tasks WHERE root_id = ?').get(rootId) as { next: number };
  return row.next;
}

function normalizePayload(raw: unknown): PortableTaskPayload {
  const p = (raw ?? {}) as Partial<PortableTaskPayload>;
  return {
    status: typeof p.status === 'string' ? p.status : 'todo',
    priority: typeof p.priority === 'string' ? p.priority : 'medium',
    labels: Array.isArray(p.labels) ? p.labels.filter((x): x is string => typeof x === 'string') : [],
    dependencies: Array.isArray(p.dependencies) ? p.dependencies.filter((x): x is string => typeof x === 'string') : [],
    taskType: p.taskType === 'bug' ? 'bug' : 'feature',
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
    completedAt: p.completedAt ?? null,
  };
}
