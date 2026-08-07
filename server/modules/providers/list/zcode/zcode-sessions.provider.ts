import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { getZcodeCliHome } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'zcode';

type ZcodeTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const buildTokenUsage = (totals: ZcodeTokenTotals): AnyRecord | undefined => {
  const inputTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const used = inputTokens + totals.outputTokens;
  if (used <= 0) return undefined;
  return {
    used,
    inputTokens,
    outputTokens: totals.outputTokens,
    breakdown: { input: inputTokens, output: totals.outputTokens },
  };
};

/**
 * Extracts a plain-text payload out of a ZCode message `parts` array. Each part
 * is `{ type, text?, time?, id?, ... }`; only `type: "text"` contributes text.
 */
const extractPartsText = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      const record = readObjectRecord(part);
      if (!record) return '';
      if (readOptionalString(record.type) !== 'text') return '';
      return readOptionalString(record.text) ?? '';
    })
    .filter(Boolean)
    .join('\n');
};

export class ZcodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes ZCode app-server notifications and `session/messages` rows into
   * frontend messages.
   *
   * Three input shapes are recognised (the spawn wrapper decides which to pass):
   *   1. `{ kind, ... }` — a `v4/telemetry/event` params object.
   *   2. `{ patch, reason, type:"state.updated" }` — a `state.updated` params object.
   *   3. `{ info: { role }, parts: [...] }` — a message row from `session/messages`.
   *
   * Telemetry events carry metadata only (stream.chunk reports `chunkLength`
   * but not the text itself); the assistant text is delivered as a complete
   * `text` message once the turn terminates, which the spawn wrapper forwards
   * here as shape (3).
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) return [];

    // Shape 3: full message row (from session/messages, or replayed by wrapper).
    const info = readObjectRecord(raw.info);
    if (info && Array.isArray(raw.parts)) {
      const role = readOptionalString(info.role);
      const timestamp = normalizeProviderTimestamp(readObjectRecord(info.time)?.created ?? info.time);
      const messageId = readOptionalString(info.id) ?? generateMessageId(PROVIDER);
      const content = extractPartsText(raw.parts);
      if (role === 'assistant') {
        if (!content.trim()) return [];
        return [createNormalizedMessage({
          id: messageId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content,
        })];
      }
      if (role === 'user' && content.trim()) {
        return [createNormalizedMessage({
          id: messageId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: 'user',
          content,
        })];
      }
      return [];
    }

    // Shape 1: telemetry event.
    const kind = readOptionalString(raw.kind);
    if (kind) {
      const timestamp = normalizeProviderTimestamp(raw.occurredAt ?? raw.time);
      const turnId = readOptionalString(raw.turnId) ?? generateMessageId(PROVIDER);

      if (kind === 'turn.terminal') {
        const isError = readOptionalString(raw.status) !== 'success' && readOptionalString(raw.resultType) !== 'success';
        return [createNormalizedMessage({
          id: turnId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: isError ? 'error' : 'complete',
          content: readOptionalString(raw.status) ?? '',
        })];
      }
      if (kind === 'turn.started') {
        return [createNormalizedMessage({
          id: turnId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'status',
          content: 'Turn started',
        })];
      }
      if (kind === 'model.request.status') {
        const status = readOptionalString(raw.status);
        return [createNormalizedMessage({
          id: readOptionalString(raw.requestId) ?? turnId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'status',
          content: status === 'model_request_started' ? 'Generating…' : '',
        })];
      }
      if (kind === 'usage.delta') {
        // Pure metadata; surfaced via token usage aggregation, not as a message.
        return [];
      }
      // Other telemetry kinds (stream.chunk without text, etc.) carry no chat payload.
      return [];
    }

    // Shape 2: state.updated (optional status nudge).
    const reason = readOptionalString(raw.reason);
    if (readOptionalString(raw.type) === 'state.updated' && reason === 'prompt_started') {
      return [createNormalizedMessage({
        id: generateMessageId(PROVIDER),
        sessionId,
        timestamp: normalizeProviderTimestamp(raw.time),
        provider: PROVIDER,
        kind: 'status',
        content: 'Working…',
      })];
    }

    return [];
  }

  /**
   * Loads ZCode history. Two sources, in priority order:
   *   1. The session row's `jsonl_path` if set (written by the synchronizer).
   *   2. The well-known rollout transcript at ~/.zcode/cli/rollout/model-io-sess_<id>.jsonl.
   *
   * The rollout file stores one `model_io` turn per line (not an event stream):
   * each turn has `request.body.messages[]`, a `response`, and `usage`.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    const sessionRow = sessionsDb.getSessionById(sessionId);
    const candidates = [
      sessionRow?.jsonl_path,
      path.join(getZcodeCliHome(), 'rollout', `model-io-${sessionId}.jsonl`),
    ].filter((p): p is string => Boolean(p));

    const filePath = candidates.find((p) => fsSync.existsSync(p));
    if (!filePath) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const { normalized, tokenUsage } = await this.parseRolloutFile(filePath, sessionId);
      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);
      let total = 0;
      for (const msg of normalized) {
        if (msg.kind !== 'tool_result') total += 1;
      }
      return { messages: page, total, hasMore, offset: normalizedOffset, limit: normalizedLimit, tokenUsage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ZcodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  /**
   * Parses a model-io rollout file. Each line is one full model turn:
   * `{ type:"model_io", sessionId, startedAt, completedAt, request:{body:{messages[]}},
   *    response, usage }`. We surface the user prompt and the assistant response
   * text per turn; tool calls live inside the response and are extracted when
   * present.
   */
  private async parseRolloutFile(
    filePath: string,
    sessionId: string,
  ): Promise<{ normalized: NormalizedMessage[]; tokenUsage?: AnyRecord }> {
    const normalized: NormalizedMessage[] = [];
    const totals: ZcodeTokenTotals = {
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    };

    const fileStream = fsSync.createReadStream(filePath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: AnyRecord;
      try { entry = JSON.parse(trimmed) as AnyRecord; } catch { continue; }

      if (readOptionalString(entry.type) !== 'model_io') continue;

      const turnStartedAt = normalizeProviderTimestamp(entry.startedAt);
      const turnCompletedAt = normalizeProviderTimestamp(entry.completedAt);

      // Accumulate usage.
      const usage = readObjectRecord(entry.usage);
      if (usage) {
        totals.inputTokens += Number(usage.inputTokens ?? 0);
        totals.outputTokens += Number(usage.outputTokens ?? 0);
        totals.reasoningTokens += Number(usage.reasoningTokens ?? 0);
        totals.cacheReadTokens += Number(usage.cacheReadTokens ?? 0);
        totals.cacheWriteTokens += Number(usage.cacheWriteTokens ?? 0);
      }

      // The request body holds the messages array sent to the model. The last
      // user message is this turn's prompt.
      const requestBody = readObjectRecord(readObjectRecord(entry.request)?.body);
      const messages = Array.isArray(requestBody?.messages) ? requestBody.messages : [];
      for (const raw of messages) {
        const msg = readObjectRecord(raw);
        if (readOptionalString(msg?.role) === 'user') {
          const content = typeof msg?.content === 'string' ? msg.content : extractContentBlocksText(msg?.content);
          if (content.trim()) {
            normalized.push(createNormalizedMessage({
              id: generateMessageId(PROVIDER),
              sessionId,
              timestamp: turnStartedAt,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content,
            }));
          }
        }
      }

      // The assistant response.
      const response = readObjectRecord(entry.response);
      const assistantText = extractResponseText(response);
      if (assistantText.trim()) {
        normalized.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          sessionId,
          timestamp: turnCompletedAt ?? turnStartedAt,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: assistantText,
        }));
      }
    }

    return { normalized, tokenUsage: buildTokenUsage(totals) };
  }
}

/**
 * Extracts text from a request message's `content`, which may be a plain string
 * or an array of OpenAI-style content blocks (`{ type:"text", text }`).
 */
const extractContentBlocksText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const record = readObjectRecord(block);
      return readOptionalString(record?.text) ?? '';
    })
    .filter(Boolean)
    .join('\n');
};

/**
 * Extracts the assistant text from a ZCode model response. The response shape
 * varies by provider kind (Anthropic vs OpenAI); we defensively read the common
 * locations: `content[].text`, `content[].content`, or a top-level `text`.
 */
const extractResponseText = (response: AnyRecord | null): string => {
  if (!response) return '';
  if (typeof response.text === 'string') return response.text;

  const content = response.content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const record = readObjectRecord(block);
        if (!record) return '';
        if (readOptionalString(record.type) && readOptionalString(record.type) !== 'text') return '';
        return readOptionalString(record.text) ?? readOptionalString(record.content) ?? '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
};
