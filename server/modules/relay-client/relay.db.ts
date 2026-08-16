// server/modules/relay-client/relay.db.ts
//
// Owns the relay_config table on the shared SQLite connection — a key/value
// store for the remote-access relay agent (device token, relay URL, enabled
// flag). Mirrors the sync module's config repository pattern.

import type { Database as DB } from 'better-sqlite3';

const RELAY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS relay_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type RelayConfigKey = 'device_token' | 'relay_url' | 'enabled' | 'device_name';

export type RelayConfig = Partial<Record<RelayConfigKey, string>>;

let ensured = false;

/** Creates the relay config table if missing. Idempotent per connection. */
export function ensureRelaySchema(db: DB): void {
  if (ensured) return;
  db.exec(RELAY_SCHEMA_SQL);
  ensured = true;
}

export function createRelayConfigRepository(db: DB) {
  ensureRelaySchema(db);

  function get(key: RelayConfigKey): string | null {
    const row = db.prepare('SELECT value FROM relay_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  function set(key: RelayConfigKey, value: string): void {
    db.prepare(
      'INSERT INTO relay_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  }

  function getAll(): RelayConfig {
    const rows = db.prepare('SELECT key, value FROM relay_config').all() as Array<{ key: string; value: string }>;
    const out: RelayConfig = {};
    for (const row of rows) {
      if (row.key === 'device_token' || row.key === 'relay_url' || row.key === 'enabled' || row.key === 'device_name') {
        out[row.key] = row.value;
      }
    }
    return out;
  }

  return { get, set, getAll };
}

export type RelayConfigRepository = ReturnType<typeof createRelayConfigRepository>;
