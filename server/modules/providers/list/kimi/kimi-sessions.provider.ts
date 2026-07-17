import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
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

const PROVIDER = 'kimi';

type KimiTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const extractText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        return readOptionalString(readObjectRecord(part)?.text) ?? '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const parseToolArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value ?? {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const buildTokenUsage = (totals: KimiTokenTotals): AnyRecord | undefined => {
  const inputTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const used = inputTokens + totals.outputTokens;
  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    inputTokens,
    outputTokens: totals.outputTokens,
    breakdown: {
      input: inputTokens,
      output: totals.outputTokens,
    },
  };
};

export class KimiSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live `kimi -p --output-format stream-json` events into frontend
   * messages. The stream is OpenAI chat-message shaped: assistant content
   * lines, assistant tool_calls lines, tool result lines, and a trailing
   * session.resume_hint meta line (handled by the spawn wrapper, not here).
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const timestamp = normalizeProviderTimestamp(raw.time ?? raw.timestamp);
    const baseId = readOptionalString(raw.id) ?? generateMessageId('kimi');
    const role = readOptionalString(raw.role);

    if (role === 'assistant') {
      const toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
      if (toolCalls.length > 0) {
        const messages: NormalizedMessage[] = [];
        for (const [index, toolCall] of toolCalls.entries()) {
          const record = readObjectRecord(toolCall);
          const fn = readObjectRecord(record?.function);
          const toolId = readOptionalString(record?.id) ?? `${baseId}_${index}`;
          messages.push(createNormalizedMessage({
            id: toolId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: readOptionalString(fn?.name) ?? 'Tool',
            toolInput: parseToolArguments(fn?.arguments),
            toolId,
          }));
        }
        return messages;
      }

      const content = extractText(raw.content);
      if (!content.trim()) {
        return [];
      }

      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_delta',
        content,
      })];
    }

    if (role === 'tool') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: readOptionalString(raw.tool_call_id) ?? '',
        content: raw.content === undefined ? '' : String(raw.content),
        isError: Boolean(raw.is_error) || raw.status === 'error',
      })];
    }

    // role "meta" (session.resume_hint) and anything else carry no chat payload.
    return [];
  }

  /**
   * Loads Kimi Code history from the session's wire.jsonl event stream.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
    if (!sessionFilePath || !fsSync.existsSync(sessionFilePath)) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const { normalized, tokenUsage } = await this.parseWireFile(sessionFilePath, sessionId);

      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      // Tail pagination via the shared contract: offset 0 returns the most
      // recent page, matching every other provider.
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);
      let total = 0;
      for (const msg of normalized) {
        if (msg.kind !== 'tool_result') {
          total += 1;
        }
      }

      return {
        messages: page,
        total,
        hasMore,
        offset: normalizedOffset,
        limit: normalizedLimit,
        tokenUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[KimiProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }
  }

  /**
   * Parses one wire.jsonl event stream. User bubbles come from turn.prompt
   * (context.append_message also replays them along with injections and
   * background-task notifications, so it is intentionally skipped); assistant
   * text/thinking and tool activity come from context.append_loop_event.
   */
  private async parseWireFile(
    sessionFilePath: string,
    sessionId: string,
  ): Promise<{ normalized: NormalizedMessage[]; tokenUsage?: AnyRecord }> {
    const normalized: NormalizedMessage[] = [];
    const tokenTotals: KimiTokenTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const fileStream = fsSync.createReadStream(sessionFilePath);
    const lineReader = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let entry: AnyRecord;
      try {
        entry = JSON.parse(trimmed) as AnyRecord;
      } catch {
        continue;
      }

      const timestamp = normalizeProviderTimestamp(entry.time);
      const type = readOptionalString(entry.type);

      if (type === 'turn.prompt') {
        const origin = readOptionalString(readObjectRecord(entry.origin)?.kind);
        const content = extractText(entry.input);
        if (origin === 'user' && content.trim()) {
          normalized.push(createNormalizedMessage({
            id: generateMessageId('kimi'),
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'text',
            role: 'user',
            content,
          }));
        }
        continue;
      }

      if (type === 'usage.record') {
        const usage = readObjectRecord(entry.usage);
        if (usage) {
          tokenTotals.inputTokens += Number(usage.inputOther ?? 0);
          tokenTotals.outputTokens += Number(usage.output ?? 0);
          tokenTotals.cacheReadTokens += Number(usage.inputCacheRead ?? 0);
          tokenTotals.cacheWriteTokens += Number(usage.inputCacheCreation ?? 0);
        }
        continue;
      }

      if (type !== 'context.append_loop_event') {
        continue;
      }

      const event = readObjectRecord(entry.event);
      const eventType = readOptionalString(event?.type);
      if (!event || !eventType) {
        continue;
      }

      if (eventType === 'content.part') {
        const part = readObjectRecord(event.part);
        const partType = readOptionalString(part?.type);
        const uuid = readOptionalString(event.uuid) ?? generateMessageId('kimi');

        if (partType === 'text') {
          const content = readOptionalString(part?.text) ?? '';
          if (content.trim()) {
            normalized.push(createNormalizedMessage({
              id: uuid,
              sessionId,
              timestamp,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content,
            }));
          }
        } else if (partType === 'think') {
          const content = readOptionalString(part?.think) ?? '';
          if (content.trim()) {
            normalized.push(createNormalizedMessage({
              id: uuid,
              sessionId,
              timestamp,
              provider: PROVIDER,
              kind: 'thinking',
              content,
            }));
          }
        }
        continue;
      }

      if (eventType === 'tool.call') {
        const toolId = readOptionalString(event.toolCallId)
          ?? readOptionalString(event.uuid)
          ?? generateMessageId('kimi');
        normalized.push(createNormalizedMessage({
          id: toolId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(event.name) ?? 'Tool',
          toolInput: event.args ?? {},
          toolId,
        }));
        continue;
      }

      if (eventType === 'tool.result') {
        const result = readObjectRecord(event.result) ?? {};
        const errorText = readOptionalString(result.error);
        const output = result.output ?? result.error;
        normalized.push(createNormalizedMessage({
          id: generateMessageId('kimi'),
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: readOptionalString(event.toolCallId) ?? '',
          content: output === undefined ? '' : (typeof output === 'string' ? output : JSON.stringify(output, null, 2)),
          isError: errorText !== undefined || result.isError === true,
        }));
        continue;
      }
    }

    // Fold tool results into their tool_use rows so the UI renders one card.
    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    return { normalized, tokenUsage: buildTokenUsage(tokenTotals) };
  }
}
