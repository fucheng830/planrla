#!/usr/bin/env node
import './load-env.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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

const planrlaApiUrl = (process.env.PLANRLA_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const planrlaApiToken = process.env.SESSION_QUERY_MCP_TOKEN || '';
const API_TIMEOUT_MS = Number.parseInt(process.env.SESSION_QUERY_API_TIMEOUT_MS || '30000', 10);
const MAX_RETURN_MESSAGES = 20;

type SessionMessage = { role: string; content: string; timestamp?: string };

const tools: ToolDefinition[] = [
  {
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
          description: 'Optional message index range [start, end). Use for "last N": { start: total-N, end: total }.',
          properties: {
            start: { type: 'number' },
            end: { type: 'number' },
          },
        },
      },
      required: ['sessionId'],
    },
  },
];

async function fetchSessionMessages(
  sessionId: string,
): Promise<{ messages: SessionMessage[]; total: number }> {
  if (!planrlaApiToken) {
    throw new Error('SESSION_QUERY_MCP_TOKEN is not configured.');
  }
  const response = await fetch(
    `${planrlaApiUrl}/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${planrlaApiToken}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch session messages (${response.status})`);
  }
  const body = (await response.json()) as {
    messages?: SessionMessage[];
    data?: { messages?: SessionMessage[] };
  };
  const messages = body.messages ?? body.data?.messages ?? [];
  return { messages, total: messages.length };
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

async function callTool(name: string, args: Record<string, unknown>) {
  if (name !== 'query_session') {
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

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'planrla-session-query', version: '1.0.0' },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
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

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(message: Record<string, unknown>) {
  // MCP stdio transport uses newline-delimited JSON (one JSON-RPC message per line,
  // no embedded newlines). This is NOT the LSP Content-Length framing.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: string | number | null | undefined, result: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null | undefined, error: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const rawMessage = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!rawMessage) {
      continue;
    }

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch (error) {
        sendError(null, error);
        return;
      }
      try {
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
  }
});
