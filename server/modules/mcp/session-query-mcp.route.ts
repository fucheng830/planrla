import express, { type Request, type Response } from 'express';

import { setSessionTitle } from './session-rename.service.js';
import { sessionsService } from '@/modules/providers/index.js';
import { searchSessions, type SessionSearchResult } from '@/modules/search/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * In-process HTTP MCP server for cross-session context lookup (REQ-016 L2).
 *
 * Why HTTP instead of stdio: the previous stdio MCP (`server/session-query-mcp.ts`)
 * lived inside `app.asar` in the packaged desktop app. Claude Code's external
 * `node` spawn cannot read files inside an asar archive, so the agent never saw
 * the `query_session` tool. Hosting the MCP as an HTTP JSON-RPC endpoint on the
 * planrla server itself keeps everything in-process — no external spawn, no
 * asar path to resolve, no token to mint. The route is mounted BEFORE the
 * `validateApiKey` / `authenticateToken` middleware because it is local-only
 * and single-user. Its tools are read-only session transcript lookups, plus
 * one write tool (`set_session_title`) whose trust boundary is identical to
 * the existing manual rename REST endpoint (PUT /sessions/:sessionId): it
 * only re-titles the local user's own session row — no auth secrets, no
 * cross-user surface.
 *
 * Transport: MCP "streamable HTTP" — a single POST per JSON-RPC request returns
 * a single JSON-RPC response. This is the shape Claude Code's `http` MCP
 * transport expects for non-streaming servers.
 */

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'planrla-session-query',
  version: '0.7.1',
} as const;

const MAX_RETURN_MESSAGES = 20;
const DEFAULT_SEARCH_LIMIT = 20;

type SessionMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const QUERY_SESSION_TOOL: ToolDefinition = {
  name: 'query_session',
  description:
    'Query messages from a referenced chat session on this host. Use to look up what was discussed / decided in another session (cross-session context). Supports keyword search or range.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'The session id to query.' },
      query: {
        type: 'string',
        description:
          'Optional case-insensitive substring to search for in message content. Returns matches + 1 message of context around each.',
      },
      range: {
        type: 'object',
        description:
          'Optional message index range [start, end). Use for "last N": { start: total-N, end: total }.',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
        },
      },
    },
    required: ['sessionId'],
  },
};

const SEARCH_CONVERSATIONS_TOOL: ToolDefinition = {
  name: 'search_conversations',
  description:
    "Search across ALL past chat sessions' content on this host (full-text, via FTS5). Use to find what was previously discussed/decided about a topic across all projects/sessions. Returns matching message snippets with session context.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The search query (full-text, matches message content across all sessions).',
      },
      limit: {
        type: 'number',
        description: 'Optional max results (default 20).',
      },
    },
    required: ['query'],
  },
};

const SET_SESSION_TITLE_TOOL: ToolDefinition = {
  name: 'set_session_title',
  description:
    'Set a custom title for a conversation session on this host. Call this AFTER you have generated a short (5-15 char) descriptive title from the conversation content, or when the user explicitly asks to rename/retitle the current or a specific session. The title is persisted and the sidebar updates in real time.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'The session id to retitle.' },
      title: {
        type: 'string',
        description: 'The new title. 1-50 chars after trim. Empty/overlong titles are rejected.',
      },
    },
    required: ['sessionId', 'title'],
  },
};

const textResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

const jsonResponse = (value: unknown) => textResponse(JSON.stringify(value, null, 2));

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function readRange(value: unknown): { start: number; end: number } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const range = value as Record<string, unknown>;
  const start = readNumber(range.start);
  const end = readNumber(range.end);
  if (start === undefined && end === undefined) {
    return undefined;
  }
  return { start: start ?? 0, end: end ?? Number.POSITIVE_INFINITY };
}

function toSessionMessage(message: NormalizedMessage): SessionMessage {
  return {
    role: message.role ?? message.kind ?? 'unknown',
    content: message.content ?? message.text ?? '',
    timestamp: message.timestamp,
  };
}

function filterByQuery(messages: SessionMessage[], query: string): SessionMessage[] {
  const q = query.toLowerCase();
  const matchIdx = new Set<number>();
  messages.forEach((m, i) => {
    if ((m.content || '').toLowerCase().includes(q)) {
      matchIdx.add(i);
      if (i > 0) matchIdx.add(i - 1);
      if (i < messages.length - 1) matchIdx.add(i + 1);
    }
  });
  return [...matchIdx].sort((a, b) => a - b).map((i) => messages[i]);
}

/**
 * Fetches persisted history in-process via `sessionsService` (the same call the
 * public `/api/providers/sessions/:sessionId/messages` route makes). No HTTP
 * round-trip, no auth token — the route handler is already inside the server.
 */
async function fetchSessionMessages(sessionId: string): Promise<{
  messages: SessionMessage[];
  total: number;
}> {
  const result = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
  const messages = result.messages.map(toSessionMessage);
  return { messages, total: result.total };
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === SEARCH_CONVERSATIONS_TOOL.name) {
    return searchConversations(args);
  }
  if (name === SET_SESSION_TITLE_TOOL.name) {
    return setSessionTitleTool(args);
  }
  if (name !== QUERY_SESSION_TOOL.name) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const sessionId = readString(args.sessionId, 'sessionId');
  const { messages, total } = await fetchSessionMessages(sessionId);

  const query = readOptionalString(args.query);
  let result: SessionMessage[];
  if (query) {
    result = filterByQuery(messages, query);
  } else {
    const range = readRange(args.range);
    if (range) {
      result = messages.slice(Math.max(0, range.start), Math.min(total, range.end));
    } else {
      result = messages.slice(Math.max(0, total - MAX_RETURN_MESSAGES));
    }
  }

  const truncated = result.length > MAX_RETURN_MESSAGES;
  if (truncated) {
    result = result.slice(0, MAX_RETURN_MESSAGES);
  }
  return jsonResponse({ messages: result, total, truncated });
}

/**
 * Maps an FTS5 session-level search row into the agent-facing shape.
 *
 * `searchSessions` is session-level (one row per session with that session's
 * best-matching snippet), NOT message-level — so we surface the session
 * context (id/title/provider/projectPath/timestamp) plus the matching snippet
 * (highlight, with `<mark>` tags) and relevance score. The agent gets enough
 * to cite the session and for the user to locate it; to read the surrounding
 * messages it can call `query_session` with this sessionId.
 */
type ConversationMatch = {
  sessionId: string;
  sessionTitle: string | null;
  provider: string;
  projectPath: string | null;
  snippet: string;
  score: number;
  timestamp: string | null;
};

function toConversationMatch(row: SessionSearchResult): ConversationMatch {
  return {
    sessionId: row.session_id,
    sessionTitle: row.custom_name,
    provider: row.provider,
    projectPath: row.project_path,
    snippet: row.highlight,
    score: row.score,
    timestamp: row.updated_at,
  };
}

async function searchConversations(args: Record<string, unknown>) {
  const query = readString(args.query, 'query');
  const limit = readNumber(args.limit);
  const rows = searchSessions(query, { limit: limit ?? DEFAULT_SEARCH_LIMIT });
  const matches = rows.map(toConversationMatch);
  return jsonResponse({
    matches,
    total: matches.length,
    truncated: matches.length >= (limit ?? DEFAULT_SEARCH_LIMIT),
    note: 'Session-level matches (one best snippet per session). Call query_session with a sessionId to read surrounding messages.',
  });
}

function setSessionTitleTool(args: Record<string, unknown>) {
  const sessionId = readString(args.sessionId, 'sessionId');
  const title = readString(args.title, 'title');
  const result = setSessionTitle(sessionId, title);
  return jsonResponse(result);
}

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }

  if (message.method === 'tools/list') {
    return { tools: [QUERY_SESSION_TOOL, SEARCH_CONVERSATIONS_TOOL, SET_SESSION_TITLE_TOOL] };
  }

  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = readString(params.name, 'name');
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};
    return callTool(name, args);
  }

  // `notifications/initialized` and any other notification: acknowledge by
  // returning no result (notifications carry no id and get no response body).
  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

const router = express.Router();

// MCP JSON-RPC over HTTP. A single POST carries one JSON-RPC request and gets
// one JSON-RPC response. Notifications (no id) get 202 with no body per spec.
router.post('/', async (req: Request, res: Response) => {
  let message: JsonRpcRequest;
  try {
    message = req.body as JsonRpcRequest;
    if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: not a JSON-RPC message.' },
      });
      return;
    }
  } catch (error) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
    return;
  }

  // Notification (no id): respond 202 with no body, per MCP streamable HTTP.
  const isNotification = message.id === undefined || message.id === null;
  if (isNotification) {
    try {
      await handleMessage(message);
    } catch {
      // Notifications cannot report errors back; swallow.
    }
    res.status(202).end();
    return;
  }

  try {
    const result = await handleMessage(message);
    res.setHeader('Content-Type', 'application/json');
    res.json({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

// Convenience GET so manual checks (curl / browser) confirm the route is alive.
router.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version });
});

export default router;
