/**
 * A2A agents repository.
 *
 * Manages per-user A2A (Agent-to-Agent) remote agent registrations.
 * Each row holds an agent endpoint (URL) plus an optional auth token used
 * by the MCP tool when forwarding requests to the remote agent.
 */

import { getConnection } from '@/modules/database/connection.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Sanitized A2A agent row (no auth_token) for list/detail APIs.
 * `auth_token` is intentionally excluded so it never leaks to the frontend.
 */
export interface A2aAgentRow {
  id: number;
  userId: number;
  name: string;
  url: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * Full agent row including auth_token. Returned only to internal callers
 * (e.g. the MCP tool) that need to sign outbound requests.
 */
interface A2aAgentWithTokenRow extends A2aAgentRow {
  authToken: string | null;
}

/** Fields that may be patched on an existing agent. */
export interface A2aAgentUpdateFields {
  name?: string;
  url?: string;
  description?: string | null;
  authToken?: string | null;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const mapRow = (row: Record<string, unknown>): A2aAgentRow => ({
  id: row.id as number,
  userId: row.user_id as number,
  name: row.name as string,
  url: row.url as string,
  description: (row.description as string | null) ?? null,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at as string,
});

const mapRowWithToken = (row: Record<string, unknown>): A2aAgentWithTokenRow => ({
  ...mapRow(row),
  authToken: (row.auth_token as string | null) ?? null,
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const a2aAgentsDb = {
  /**
   * Lists all active A2A agents for a user as a compact, secret-free summary
   * (name/url/description/has_auth). Used by the MCP `a2a_list` tool so the
   * agent can enumerate registered targets without ever receiving the token.
   * `has_auth` is a boolean flag derived from `auth_token IS NOT NULL`.
   * Only active agents are returned (matches `getAgentForCall` visibility).
   */
  getAgentsList(userId: number): Array<{ name: string; url: string; description: string | null; hasAuth: boolean }> {
    const db = getConnection();
    const rows = db
      .prepare(
        'SELECT name, url, description, (auth_token IS NOT NULL AND auth_token != \'\') AS has_auth FROM a2a_agents WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC'
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map((row) => ({
      name: row.name as string,
      url: row.url as string,
      description: (row.description as string | null) ?? null,
      hasAuth: Boolean(row.has_auth),
    }));
  },

  /**
   * Lists all A2A agents for a user (excluding auth_token).
   * Used by list/detail APIs that must not leak secrets.
   */
  getAgents(userId: number): A2aAgentRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        'SELECT id, user_id, name, url, description, is_active, created_at FROM a2a_agents WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map(mapRow);
  },

  /**
   * Returns the active agent (including auth_token) whose name matches the
   * given name case-insensitively, or null if none exists.
   * Used by the MCP tool to sign outbound A2A requests.
   */
  getAgentForCall(userId: number, name: string): A2aAgentWithTokenRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        'SELECT id, user_id, name, url, description, auth_token, is_active, created_at FROM a2a_agents WHERE user_id = ? AND LOWER(name) = LOWER(?) AND is_active = 1 LIMIT 1'
      )
      .get(userId, name) as Record<string, unknown> | undefined;
    return row ? mapRowWithToken(row) : null;
  },

  /** Creates a new A2A agent and returns its id. */
  createAgent(
    userId: number,
    name: string,
    url: string,
    description: string | null = null,
    authToken: string | null = null
  ): number {
    const db = getConnection();
    const result = db
      .prepare(
        'INSERT INTO a2a_agents (user_id, name, url, description, auth_token) VALUES (?, ?, ?, ?, ?)'
      )
      .run(userId, name, url, description, authToken);
    return Number(result.lastInsertRowid);
  },

  /**
   * Updates the provided fields on an agent owned by the user.
   * Only supplied fields are written; camelCase keys are mapped to snake_case
   * columns. Returns true if a row was updated.
   */
  updateAgent(userId: number, id: number, fields: A2aAgentUpdateFields): boolean {
    const db = getConnection();

    const setClauses: string[] = [];
    const values: Array<string | number | null> = [];

    if (fields.name !== undefined) {
      setClauses.push('name = ?');
      values.push(fields.name);
    }
    if (fields.url !== undefined) {
      setClauses.push('url = ?');
      values.push(fields.url);
    }
    if (fields.description !== undefined) {
      setClauses.push('description = ?');
      values.push(fields.description);
    }
    if (fields.authToken !== undefined) {
      setClauses.push('auth_token = ?');
      values.push(fields.authToken);
    }
    if (fields.isActive !== undefined) {
      setClauses.push('is_active = ?');
      values.push(fields.isActive ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return false;
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    const result = db
      .prepare(
        `UPDATE a2a_agents SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
      )
      .run(...values);
    return result.changes > 0;
  },

  /** Permanently removes an agent. Returns true if a row was deleted. */
  deleteAgent(userId: number, id: number): boolean {
    const db = getConnection();
    const result = db
      .prepare('DELETE FROM a2a_agents WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  },
};
