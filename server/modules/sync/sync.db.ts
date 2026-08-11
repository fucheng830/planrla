// server/modules/sync/sync.db.ts
//
// Owns the two sync tables on the shared SQLite connection:
//   sync_config       — single-row key/value store (cloud_url, team_id, ...)
//   task_tombstones   — records locally hard-deleted task ids so they can be
//                       propagated to teammates as soft-delete markers.
//
// Mirrors the kanban store's pattern: call ensureSyncSchema() once at module
// init, then export a repository object.

import type { Database as DB } from 'better-sqlite3';

const SYNC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tombstones (
  task_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tombstones_root ON task_tombstones(root_id);
`;

export type SyncConfigKey =
  | 'cloud_url'
  | 'team_id'
  | 'team_name'
  | 'instance_id'
  | 'instance_name'
  | 'instance_token'
  | 'last_pull_at';

export type SyncConfig = Partial<Record<SyncConfigKey, string>>;

let ensured = false;

/** Creates the sync tables if missing. Idempotent. */
export function ensureSyncSchema(db: DB): void {
  if (ensured) return;
  db.exec(SYNC_SCHEMA_SQL);
  ensured = true;
}

export function createSyncConfigRepository(db: DB) {
  ensureSyncSchema(db);

  function getAll(): SyncConfig {
    const rows = db.prepare('SELECT key, value FROM sync_config').all() as { key: string; value: string }[];
    const out: SyncConfig = {};
    for (const r of rows) (out as Record<string, string>)[r.key] = r.value;
    return out;
  }

  function get(key: SyncConfigKey): string | undefined {
    const row = db.prepare('SELECT value FROM sync_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  function set(key: SyncConfigKey, value: string): void {
    db.prepare('INSERT INTO sync_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  function setMany(entries: SyncConfig): void {
    const tx = db.transaction((items: [SyncConfigKey, string][]) => {
      for (const [k, v] of items) set(k, v);
    });
    tx(Object.entries(entries) as [SyncConfigKey, string][]);
  }

  function clear(keys: SyncConfigKey[]): void {
    if (keys.length === 0) return;
    const placeholders = keys.map(() => '?').join(', ');
    db.prepare(`DELETE FROM sync_config WHERE key IN (${placeholders})`).run(...keys);
  }

  /** True when the instance is provisioned enough to sync (cloud + token). */
  function isConfigured(): boolean {
    return Boolean(get('cloud_url') && get('instance_token') && get('team_id'));
  }

  return { getAll, get, set, setMany, clear, isConfigured };
}

export type SyncConfigRepository = ReturnType<typeof createSyncConfigRepository>;

/** Records a locally deleted task so its deletion can be synced to teammates. */
export function recordTombstone(db: DB, taskId: string, rootId: string): void {
  ensureSyncSchema(db);
  db.prepare(
    'INSERT OR REPLACE INTO task_tombstones (task_id, root_id, deleted_at) VALUES (?, ?, ?)',
  ).run(taskId, rootId, Date.now());
}

/** Lists and clears tombstones older than maxAgeMs (returns them for sync push). */
export function drainTombstones(db: DB, maxAgeMs = 7 * 24 * 3600 * 1000): { taskId: string; rootId: string; deletedAt: number }[] {
  ensureSyncSchema(db);
  const cutoff = Date.now() - maxAgeMs;
  const rows = db.prepare('SELECT task_id, root_id, deleted_at FROM task_tombstones').all() as {
    task_id: string; root_id: string; deleted_at: number;
  }[];
  // Drop expired tombstones (older than maxAgeMs).
  const expired = rows.filter((r) => r.deleted_at < cutoff).map((r) => r.task_id);
  if (expired.length > 0) {
    const placeholders = expired.map(() => '?').join(', ');
    db.prepare(`DELETE FROM task_tombstones WHERE task_id IN (${placeholders})`).run(...expired);
  }
  return rows
    .filter((r) => r.deleted_at >= cutoff)
    .map((r) => ({ taskId: r.task_id, rootId: r.root_id, deletedAt: r.deleted_at }));
}

/** Removes a tombstone once the cloud confirms the deletion was synced. */
export function clearTombstone(db: DB, taskId: string): void {
  ensureSyncSchema(db);
  db.prepare('DELETE FROM task_tombstones WHERE task_id = ?').run(taskId);
}
