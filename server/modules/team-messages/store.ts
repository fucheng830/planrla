import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/index.js';

export interface TeamMessage {
  id: string;
  rootId: string;
  sender: string;
  content: string;
  taskId: string | null;
  createdAt: string;
}

interface TeamMessageRow {
  id: string;
  root_id: string;
  sender: string;
  content: string;
  task_id: string | null;
  created_at: string;
}

function rowToMessage(row: TeamMessageRow): TeamMessage {
  return {
    id: row.id,
    rootId: row.root_id,
    sender: row.sender,
    content: row.content,
    taskId: row.task_id ?? null,
    createdAt: row.created_at,
  };
}

export function createTeamMessageStore(deps: { db?: Database } = {}) {
  const db = deps.db ?? getConnection();

  function listMessages(rootId: string, limit = 100): TeamMessage[] {
    const rows = db
      .prepare('SELECT * FROM team_messages WHERE root_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(rootId, limit) as TeamMessageRow[];
    return rows.map(rowToMessage);
  }

  function createMessage(input: { rootId: string; sender: string; content: string; taskId?: string | null }): TeamMessage {
    const message: TeamMessage = {
      id: randomUUID(),
      rootId: input.rootId,
      sender: input.sender,
      content: input.content,
      taskId: input.taskId ?? null,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO team_messages (id, root_id, sender, content, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.rootId, message.sender, message.content, message.taskId, message.createdAt);
    return message;
  }

  function deleteMessage(id: string, rootId: string): void {
    db.prepare('DELETE FROM team_messages WHERE id = ? AND root_id = ?').run(id, rootId);
  }

  return { listMessages, createMessage, deleteMessage };
}
