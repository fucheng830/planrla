import { randomUUID } from 'node:crypto';

import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/index.js';

export type MessageKind = 'team' | 'customer';

export interface TeamMessage {
  id: string;
  rootId: string;
  /** 'team' = 同事协作消息;'customer' = 客户咨询/沟通记录。 */
  kind: MessageKind;
  channel: string | null;
  /** Customer conversations group by thread (threadId ?? id). */
  threadId: string | null;
  sender: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

interface TeamMessageRow {
  id: string;
  root_id: string;
  kind: MessageKind;
  channel: string | null;
  thread_id: string | null;
  sender: string;
  content: string;
  task_id: string | null;
  created_at: string;
}

function rowToMessage(row: TeamMessageRow): TeamMessage {
  return {
    id: row.id,
    rootId: row.root_id,
    kind: row.kind === 'customer' ? 'customer' : 'team',
    channel: row.channel ?? null,
    threadId: row.thread_id ?? null,
    sender: row.sender,
    content: row.content,
    taskId: row.task_id ?? null,
    createdAt: row.created_at,
  };
}

export function createTeamMessageStore(deps: { db?: Database } = {}) {
  const db = deps.db ?? getConnection();

  function listMessages(rootId: string, limit = 100, kind?: MessageKind): TeamMessage[] {
    const rows = (
      kind
        ? db.prepare('SELECT * FROM team_messages WHERE root_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        : db.prepare('SELECT * FROM team_messages WHERE root_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    ).all(...(kind ? [rootId, kind, limit] : [rootId, limit])) as TeamMessageRow[];
    return rows.map(rowToMessage);
  }

  function createMessage(input: {
    rootId: string;
    kind?: MessageKind;
    channel?: string | null;
    threadId?: string | null;
    sender: string;
    content: string;
    taskId?: string | null;
  }): TeamMessage {
    const message: TeamMessage = {
      id: randomUUID(),
      rootId: input.rootId,
      kind: input.kind === 'customer' ? 'customer' : 'team',
      channel: input.channel ?? null,
      threadId: input.threadId ?? null,
      sender: input.sender,
      content: input.content,
      taskId: input.taskId ?? null,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO team_messages (id, root_id, kind, channel, thread_id, sender, content, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(message.id, message.rootId, message.kind, message.channel, message.threadId, message.sender, message.content, message.taskId, message.createdAt);
    return message;
  }

  function deleteMessage(id: string, rootId: string): void {
    db.prepare('DELETE FROM team_messages WHERE id = ? AND root_id = ?').run(id, rootId);
  }

  /** Team-kind messages created after `sinceMs`, across all project roots —
   *  the sync push feed. */
  function listMessagesSince(sinceMs: number): TeamMessage[] {
    const sinceIso = new Date(sinceMs).toISOString();
    const rows = db.prepare(
      "SELECT * FROM team_messages WHERE kind = 'team' AND created_at > ? ORDER BY created_at ASC LIMIT 500",
    ).all(sinceIso) as TeamMessageRow[];
    return rows.map(rowToMessage);
  }

  /** Ingests a teammate's message from the sync relay. Preserves the origin
   *  id/author/timestamp; INSERT OR IGNORE makes redelivery a no-op.
   *  Returns true when the row is new (caller broadcasts it). */
  function ingestRemoteMessage(input: {
    id: string; rootId: string; channel?: string | null; threadId?: string | null;
    sender: string; content: string; taskId?: string | null; createdAt: number;
  }): boolean {
    const createdAt = new Date(input.createdAt).toISOString();
    const r = db.prepare(
      "INSERT OR IGNORE INTO team_messages (id, root_id, kind, channel, thread_id, sender, content, task_id, created_at) VALUES (?, ?, 'team', ?, ?, ?, ?, ?, ?)",
    ).run(input.id, input.rootId, input.channel ?? null, input.threadId ?? null,
          input.sender.slice(0, 60), input.content.slice(0, 4000), input.taskId ?? null, createdAt);
    return r.changes > 0;
  }

  return { listMessages, createMessage, deleteMessage, listMessagesSince, ingestRemoteMessage };
}
