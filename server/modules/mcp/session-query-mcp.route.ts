import express, { type Request, type Response } from 'express';
import * as realCron from 'node-cron';

import { searchSessions, type SessionSearchResult } from '@/modules/search/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import {
  cronPromptsDriver,
  cronPromptsStore,
  normalizeLlmScheduleInput,
} from '@/modules/cron-prompts/index.js';
import { providerCapabilitiesService, sessionsService } from '@/modules/providers/index.js';
import { sessionsDb } from '@/modules/database/index.js';

import { setSessionTitle } from './session-rename.service.js';

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

const SCHEDULE_CREATE_TOOL: ToolDefinition = {
  name: 'schedule_create',
  description:
    'Create a recurring LLM task immediately. Each trigger creates a new LLM session and runs the natural-language prompt in the selected project. No approval is required.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable schedule name.' },
      cronExpression: { type: 'string', description: 'Standard five-field cron expression, for example 0 9 * * 1-5.' },
      prompt: { type: 'string', description: 'The natural-language task the LLM should execute on every trigger.' },
      provider: { type: 'string', description: 'LLM provider, default claude.' },
      projectPath: { type: 'string', description: 'Absolute project path where the LLM session should work.' },
      sessionMode: {
        type: 'string',
        description:
          'new creates a fresh session per trigger (default). resume wakes the bound session and appends the prompt as a new turn, preserving conversation context.',
      },
      boundSessionId: {
        type: 'string',
        description: 'App session id to wake. Required when sessionMode is resume.',
      },
      permissionMode: {
        type: 'string',
        description:
          'Runtime permission mode for headless runs: default, acceptEdits, or bypassPermissions. Provider support varies; bypassPermissions is the default.',
      },
      catchUp: {
        type: 'boolean',
        description:
          'When true (default), a missed trigger caused by downtime/sleep is caught up once on startup, within a 7-day window. Each downtime window catches up at most one run.',
      },
      maxRuns: {
        type: 'number',
        description:
          'Total run limit for a finite task. Omit for recurring (default). When set (e.g. 1 for a one-shot reminder), the task auto-completes after N dispatches.',
      },
      notifyInbox: { type: 'boolean', description: 'Send a completion notice to the project inbox, default true.' },
    },
    required: ['name', 'cronExpression', 'prompt', 'projectPath'],
  },
};

const SCHEDULE_LIST_TOOL: ToolDefinition = {
  name: 'schedule_list',
  description: 'List recurring LLM schedules currently configured on this host.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const SCHEDULE_DELETE_TOOL: ToolDefinition = {
  name: 'schedule_delete',
  description: 'Delete an existing recurring LLM schedule by id immediately. No approval is required.',
  inputSchema: {
    type: 'object',
    properties: { scheduleId: { type: 'string' } },
    required: ['scheduleId'],
  },
};

const SCHEDULE_UPDATE_TOOL: ToolDefinition = {
  name: 'schedule_update',
  description: 'Update an existing recurring LLM schedule immediately. No approval is required.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'string' },
      name: { type: 'string' },
      cronExpression: { type: 'string' },
      prompt: { type: 'string' },
      provider: { type: 'string' },
      projectPath: { type: 'string' },
      sessionMode: { type: 'string' },
      boundSessionId: { type: 'string' },
      permissionMode: { type: 'string' },
      catchUp: { type: 'boolean' },
      notifyInbox: { type: 'boolean' },
      enabled: { type: 'boolean' },
    },
    required: ['scheduleId'],
  },
};

const SCHEDULE_RUN_NOW_TOOL: ToolDefinition = {
  name: 'schedule_run_now',
  description: 'Start one immediate LLM run for an existing schedule. It creates a new LLM session using the saved prompt.',
  inputSchema: {
    type: 'object',
    properties: { scheduleId: { type: 'string' } },
    required: ['scheduleId'],
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
  if (name === SCHEDULE_CREATE_TOOL.name) {
    return createSchedule(args);
  }
  if (name === SCHEDULE_LIST_TOOL.name) {
    return listSchedules();
  }
  if (name === SCHEDULE_DELETE_TOOL.name) {
    return deleteSchedule(args);
  }
  if (name === SCHEDULE_UPDATE_TOOL.name) {
    return updateSchedule(args);
  }
  if (name === SCHEDULE_RUN_NOW_TOOL.name) {
    return runScheduleNow(args);
  }
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

function createSchedule(args: Record<string, unknown>) {
  const provider = readOptionalString(args.provider) ?? 'claude';
  const requestedPermissionMode = readOptionalString(args.permissionMode) ?? 'bypassPermissions';
  const sessionMode = readOptionalString(args.sessionMode) === 'resume' ? 'resume' as const : 'new' as const;
  const boundSessionId = readOptionalString(args.boundSessionId) ?? null;
  if (sessionMode === 'resume') {
    const bound = boundSessionId ? sessionsDb.getSessionById(boundSessionId) : null;
    if (!bound) throw new Error(`boundSessionId "${boundSessionId}" does not exist`);
    if (bound.provider !== provider) {
      throw new Error(`bound session provider "${bound.provider}" does not match task provider "${provider}"`);
    }
  }
  const capabilities = providerCapabilitiesService.getProviderCapabilities(provider as never);
  if (!capabilities?.permissionModes?.includes(requestedPermissionMode)) {
    throw new Error(`invalid permissionMode "${requestedPermissionMode}" for provider "${provider}"`);
  }
  const input = normalizeLlmScheduleInput({
    name: readString(args.name, 'name'),
    cronExpression: readString(args.cronExpression, 'cronExpression'),
    prompt: readString(args.prompt, 'prompt'),
    provider,
    projectPath: readString(args.projectPath, 'projectPath'),
    sessionMode,
    boundSessionId,
    permissionMode: requestedPermissionMode,
    catchUp: args.catchUp !== false,
    maxRuns: typeof args.maxRuns === 'number' && Number.isInteger(args.maxRuns) && args.maxRuns > 0 ? args.maxRuns : null,
    notifyInbox: args.notifyInbox !== false,
  }, (expression) => realCron.validate(expression));

  const task = cronPromptsStore.create(input);
  cronPromptsDriver.reload();
  return jsonResponse({ status: 'created', schedule: task });
}

function listSchedules() {
  return jsonResponse({ schedules: cronPromptsStore.list() });
}

function deleteSchedule(args: Record<string, unknown>) {
  const scheduleId = readString(args.scheduleId, 'scheduleId');
  const deleted = cronPromptsStore.delete(scheduleId);
  if (!deleted) throw new Error('schedule not found');
  cronPromptsDriver.reload();
  return jsonResponse({ status: 'deleted', scheduleId });
}

function updateSchedule(args: Record<string, unknown>) {
  const scheduleId = readString(args.scheduleId, 'scheduleId');
  const fields: Parameters<typeof cronPromptsStore.update>[1] = {};
  if (typeof args.name === 'string' && args.name.trim()) fields.name = args.name.trim();
  if (typeof args.cronExpression === 'string' && args.cronExpression.trim()) {
    const expression = args.cronExpression.trim();
    if (!realCron.validate(expression)) throw new Error(`invalid cron expression: ${expression}`);
    fields.cronExpression = expression;
  }
  if (typeof args.prompt === 'string' && args.prompt.trim()) fields.prompt = args.prompt.trim();
  if (typeof args.provider === 'string' && args.provider.trim()) fields.provider = args.provider.trim();
  if (typeof args.projectPath === 'string') fields.projectPath = args.projectPath.trim().replace(/[\\/]+/g, '/');
  const requestedMode = readOptionalString(args.sessionMode);
  if (requestedMode === 'resume' || requestedMode === 'new') {
    fields.sessionMode = requestedMode;
  }
  const requestedBoundSessionId = readOptionalString(args.boundSessionId);
  if (requestedBoundSessionId) fields.boundSessionId = requestedBoundSessionId;
  if (typeof args.permissionMode === 'string' && args.permissionMode.trim()) {
    fields.permissionMode = args.permissionMode.trim();
  }
  if (typeof args.catchUp === 'boolean') fields.catchUp = args.catchUp;
  if (typeof args.notifyInbox === 'boolean') fields.notifyInbox = args.notifyInbox;
  if (typeof args.enabled === 'boolean') fields.enabled = args.enabled;
  if (Object.keys(fields).length === 0) throw new Error('at least one schedule field is required');
  const task = cronPromptsStore.update(scheduleId, fields);
  if (!task) throw new Error('schedule not found');
  cronPromptsDriver.reload();
  return jsonResponse({ status: 'updated', schedule: task });
}

async function runScheduleNow(args: Record<string, unknown>) {
  const scheduleId = readString(args.scheduleId, 'scheduleId');
  const task = cronPromptsStore.getById(scheduleId);
  if (!task) throw new Error('schedule not found');
  const result = await cronPromptsDriver.runNow(scheduleId);
  return jsonResponse({ status: 'started', schedule: task, result });
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
    return {
      tools: [
        QUERY_SESSION_TOOL,
        SEARCH_CONVERSATIONS_TOOL,
        SET_SESSION_TITLE_TOOL,
        SCHEDULE_CREATE_TOOL,
        SCHEDULE_LIST_TOOL,
        SCHEDULE_UPDATE_TOOL,
        SCHEDULE_DELETE_TOOL,
        SCHEDULE_RUN_NOW_TOOL,
      ],
    };
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
