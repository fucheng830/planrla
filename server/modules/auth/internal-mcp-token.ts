/**
 * Internal service token for planrla's own stdio MCP servers.
 *
 * Why this exists: the `session-query` MCP server is spawned by external
 * provider CLIs (Claude / Codex / Cursor / Gemini / OpenCode) as a long-lived
 * stdio child process. It calls back into planrla's REST API to read session
 * messages — a route mounted under `authenticateToken`. A short-lived user JWT
 * does not work here: the spawned process cannot refresh tokens via the
 * `X-Refreshed-Token` header, so the token would silently expire mid-session.
 *
 * This mirrors the established `browser_use_mcp_token` pattern: a persistent
 * random secret stored in `app_config`, minted once on first boot, accepted by
 * `authenticateToken` via a constant-time comparison. The token never leaves
 * the host process tree (server → MCP env var → localhost callback).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { appConfigDb } from '@/modules/database/index.js';

const SESSION_QUERY_MCP_TOKEN_KEY = 'session_query_mcp_token';

function generate(): string {
  return randomBytes(32).toString('hex');
}

/** Returns the persisted internal MCP token, creating one on first call. */
function getOrCreate(): string {
  const existing = appConfigDb.get(SESSION_QUERY_MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = generate();
  appConfigDb.set(SESSION_QUERY_MCP_TOKEN_KEY, token);
  return token;
}

/**
 * Constant-time check whether a presented bearer token matches the internal
 * session-query MCP token. Returns false when the input is missing or no
 * internal token has been minted yet.
 */
function matches(presented: string | null | undefined): boolean {
  if (!presented) {
    return false;
  }
  const expected = appConfigDb.get(SESSION_QUERY_MCP_TOKEN_KEY);
  if (!expected) {
    return false;
  }
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  if (presentedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(presentedBuf, expectedBuf);
}

export const internalMcpToken = {
  getOrCreate,
  matches,
};
