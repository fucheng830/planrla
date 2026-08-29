import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, CompactionEpochInfo, CompactionView, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, sliceTailPage, truncateJsonlByTimestamp } from '@/shared/utils.js';
import { sessionsDb } from '@/modules/database/index.js';

const PROVIDER = 'claude';

type ClaudeToolResult = {
  content: unknown;
  isError: boolean;
  subagentTools?: unknown;
  toolUseResult?: unknown;
};

async function parseAgentTools(filePath: string): Promise<AnyRecord[]> {
  const tools: AnyRecord[] = [];

  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;

        if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content as AnyRecord[]) {
            if (part.type === 'tool_use') {
              tools.push({
                toolId: part.id,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp,
              });
            }
          }
        }

        if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content as AnyRecord[]) {
            if (part.type !== 'tool_result') {
              continue;
            }

            const tool = tools.find((candidate) => candidate.toolId === part.tool_use_id);
            if (!tool) {
              continue;
            }

            tool.toolResult = {
              content: typeof part.content === 'string'
                ? part.content
                : Array.isArray(part.content)
                  ? part.content
                    .map((contentPart: AnyRecord) => contentPart?.text || '')
                    .join('\n')
                  : JSON.stringify(part.content),
              isError: Boolean(part.is_error),
            };
          }
        }
      } catch {
        // Skip malformed lines that can happen during concurrent writes.
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Error parsing agent file ${filePath}:`, message);
  }

  return tools;
}

/**
 * Streams the raw transcript rows for one provider session in FILE ORDER.
 *
 * REQ-052: timestamp sorting is applied later, after compaction boundaries
 * have been located — boundary detection must never depend on the sort because
 * same-millisecond rows can reorder around a boundary and shift it by one.
 */
async function getSessionMessages(
  sessionId: string,
  providerSessionId: string,
): Promise<AnyRecord[]> {
  try {
    // The DB row is keyed by the app-facing session id, while the JSONL rows
    // on disk carry the provider-native id — both ids are needed here.
    const jsonLPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!jsonLPath) {
      return [];
    }

    const projectDir = path.dirname(jsonLPath);
    const files = await fsp.readdir(projectDir);
    const agentFiles = files.filter((file) => file.endsWith('.jsonl') && file.startsWith('agent-'));

    const messages: AnyRecord[] = [];
    const agentToolsCache = new Map<string, AnyRecord[]>();

    const fileStream = fs.createReadStream(jsonLPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;
        if (entry.sessionId === providerSessionId) {
          messages.push(entry);
        }
      } catch {
        // Skip malformed JSONL lines that can happen during concurrent writes.
      }
    }

    const agentIds = new Set<string>();
    for (const message of messages) {
      const agentId = message.toolUseResult?.agentId;
      if (agentId) {
        agentIds.add(String(agentId));
      }
    }

    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (!agentFiles.includes(agentFileName)) {
        continue;
      }

      const agentFilePath = path.join(projectDir, agentFileName);
      const tools = await parseAgentTools(agentFilePath);
      agentToolsCache.set(agentId, tools);
    }

    for (const message of messages) {
      const agentId = message.toolUseResult?.agentId;
      if (!agentId) {
        continue;
      }

      const agentTools = agentToolsCache.get(String(agentId));
      if (agentTools && agentTools.length > 0) {
        message.subagentTools = agentTools;
      }
    }

    return messages;
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return [];
  }
}

/**
 * REQ-052: locates compaction boundaries (Claude's synthetic `isCompactSummary`
 * rows) in FILE ORDER. Returns raw array indices, oldest first.
 */
function findBoundaryIndices(rawMessages: AnyRecord[]): number[] {
  const indices: number[] = [];
  rawMessages.forEach((raw, index) => {
    if (raw.isCompactSummary === true) {
      indices.push(index);
    }
  });
  return indices;
}

/** Stable timestamp sort — equal timestamps keep transcript file order. */
function sortByTimestamp(rows: AnyRecord[]): AnyRecord[] {
  return [...rows].sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
  );
}

function boundaryTimestampOf(raw: AnyRecord): string {
  return typeof raw.timestamp === 'string' ? raw.timestamp : new Date(0).toISOString();
}

/**
 * Claude writes a mix of truly internal transcript rows and "UI-hidden" local
 * command artifacts into the same JSONL stream.
 *
 * Important distinction:
 * - system reminders / caveats / interruption banners should stay hidden
 * - local command payloads (`<command-name>...`) and stdout wrappers
 *   (`<local-command-stdout>...`) should be remapped into normal chat messages
 *   instead of being discarded as internal content
 */
const INTERNAL_CONTENT_PREFIXES = [
  '<system-reminder>',
  'Caveat:',
  '[Request interrupted',
] as const;

function isInternalContent(content: string): boolean {
  return INTERNAL_CONTENT_PREFIXES.some((prefix) => content.startsWith(prefix));
}

/**
 * Claude wraps local slash-command metadata in lightweight XML-like tags inside
 * a plain string payload. We intentionally parse only the small tag surface we
 * care about instead of introducing a generic XML parser for untrusted history.
 */
function extractTaggedContent(content: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
}

type ClaudeLocalCommandPayload = {
  commandName: string;
  commandMessage: string;
  commandArgs: string;
};

/**
 * Converts Claude's hidden local command wrapper into structured metadata.
 *
 * The three tags often coexist in one string payload. Returning `null` lets the
 * normal text path continue untouched for unrelated messages.
 */
function parseLocalCommandPayload(content: string): ClaudeLocalCommandPayload | null {
  const commandName = extractTaggedContent(content, 'command-name');
  const commandMessage = extractTaggedContent(content, 'command-message');
  const commandArgs = extractTaggedContent(content, 'command-args');

  if (commandName === null && commandMessage === null && commandArgs === null) {
    return null;
  }

  return {
    commandName: commandName ?? '',
    commandMessage: commandMessage ?? '',
    commandArgs: commandArgs ?? '',
  };
}

/**
 * Produces the short user-visible command string that should appear in chat.
 *
 * We prefer the slash-prefixed command name because that most closely matches
 * what the user actually typed, and only fall back to the message body when the
 * command name is unavailable in older transcript variants.
 */
function buildLocalCommandDisplayText(payload: ClaudeLocalCommandPayload): string {
  const commandName = payload.commandName.trim();
  const commandMessage = payload.commandMessage.trim();
  const commandArgs = payload.commandArgs.trim();
  const baseCommand = commandName || commandMessage;

  if (!baseCommand) {
    return '';
  }

  return commandArgs ? `${baseCommand} ${commandArgs}` : baseCommand;
}

/**
 * Claude local-command stdout may contain ANSI styling codes because it was
 * captured from the terminal. The web chat should receive readable plain text.
 */
function stripAnsiFormatting(text: string): string {
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/**
 * REQ-049 fork: streams a copied transcript snapshot line-by-line without the
 * provider-session-id filter that `getSessionMessages` applies. The fork copy
 * is an app-owned whole-file snapshot, so every record belongs to the forked
 * conversation.
 */
async function readJsonlFileRaw(filePath: string): Promise<AnyRecord[]> {
  const records: AnyRecord[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as AnyRecord);
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return records;
}

type NormalizedSegment = { messages: NormalizedMessage[]; total: number };

/**
 * Normalizes one raw segment (tool results attached, page total counted the
 * same way as every provider: `tool_result` kinds attach to their `tool_use`
 * and never count twice). Segment rows are timestamp-sorted first so the
 * visible ordering matches the legacy whole-transcript behavior.
 */
function normalizeRawSegment(
  rawSegment: AnyRecord[],
  sessionId: string,
  normalizeMessage: (rawMessage: unknown, sessionId: string | null) => NormalizedMessage[],
): NormalizedSegment {
  const toolResultMap = new Map<string, ClaudeToolResult>();
  for (const raw of rawSegment) {
    if (raw.message?.role === 'user' && Array.isArray(raw.message?.content)) {
      for (const part of raw.message.content) {
        if (part.type === 'tool_result' && part.tool_use_id) {
          toolResultMap.set(part.tool_use_id, {
            content: part.content,
            isError: Boolean(part.is_error),
            subagentTools: raw.subagentTools,
            toolUseResult: raw.toolUseResult,
          });
        }
      }
    }
  }

  const normalized: NormalizedMessage[] = [];
  for (const raw of sortByTimestamp(rawSegment)) {
    normalized.push(...normalizeMessage(raw, sessionId));
  }

  for (const msg of normalized) {
    if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
      const toolResult = toolResultMap.get(msg.toolId);
      if (!toolResult) {
        continue;
      }

      msg.toolResult = {
        content: typeof toolResult.content === 'string'
          ? toolResult.content
          : JSON.stringify(toolResult.content),
        isError: toolResult.isError,
        toolUseResult: toolResult.toolUseResult,
      };
      msg.subagentTools = toolResult.subagentTools;
    }
  }

  let total = 0;
  for (const msg of normalized) {
    if (msg.kind !== 'tool_result') {
      total += 1;
    }
  }

  return { messages: normalized, total };
}

/**
 * REQ-052: raw index bounds of one archive epoch. Epoch k = the rows after
 * epoch k-1's boundary through epoch k's boundary summary row inclusive (the
 * summary is the archived epoch's closing message).
 */
function epochSegmentBounds(boundaryIndices: number[], epoch: number): { start: number; end: number } | null {
  if (epoch < 1 || epoch > boundaryIndices.length) {
    return null;
  }
  const end = boundaryIndices[epoch - 1];
  const start = epoch === 1 ? 0 : boundaryIndices[epoch - 2] + 1;
  return { start, end: end + 1 };
}

function buildEpochInfo(rawMessages: AnyRecord[], boundaryIndices: number[], epoch: number): CompactionEpochInfo {
  const raw = rawMessages[boundaryIndices[epoch - 1]];
  return {
    epoch,
    boundaryTimestamp: boundaryTimestampOf(raw),
    archivedMessages: null,
    trigger: null,
  };
}

type CachedCompactionEpochRow = ReturnType<typeof sessionsDb.listCompactionEpochs>[number];

function boundaryUuidOf(raw: AnyRecord): string | null {
  return typeof raw.uuid === 'string' ? raw.uuid : null;
}

/**
 * True when a cached row describes exactly this boundary row — same uuid, or
 * same timestamp when the transcript row carries no uuid. A mismatch means the
 * epoch set changed (new compaction or CLI rewrite) and the row must be
 * refreshed, never served.
 */
function cachedRowMatchesBoundary(row: CachedCompactionEpochRow, raw: AnyRecord): boolean {
  const uuid = boundaryUuidOf(raw);
  if (row.boundary_uuid !== uuid) {
    return false;
  }
  return uuid !== null || row.boundary_timestamp === boundaryTimestampOf(raw);
}

/**
 * Best-effort cache sync; a failed cache row can never break a history read.
 *
 * 复盘修正: the epoch set is compared against the cache BEFORE any write —
 * steady state (same boundaries as the previous scan) costs one SELECT and
 * zero writes, so legacy `view=all` readers no longer upsert N rows on every
 * GET. Rows beyond the current boundary count (transcript shrank after a CLI
 * rewrite/cleanup) are pruned so the table cannot accumulate ghost epochs.
 */
function cacheEpochs(
  rawMessages: AnyRecord[],
  boundaryIndices: number[],
  cacheSessionId: string | null,
): void {
  if (!cacheSessionId) {
    return;
  }
  try {
    const cached = sessionsDb.listCompactionEpochs(cacheSessionId);
    const setMatches = cached.length === boundaryIndices.length
      && cached.every((row, i) => cachedRowMatchesBoundary(row, rawMessages[boundaryIndices[i]]));
    if (!setMatches) {
      boundaryIndices.forEach((rawIndex, i) => {
        const raw = rawMessages[rawIndex];
        sessionsDb.upsertCompactionEpoch({
          sessionId: cacheSessionId,
          epoch: i + 1,
          boundaryUuid: boundaryUuidOf(raw),
          boundaryTimestamp: boundaryTimestampOf(raw),
          trigger: null,
          preTokens: null,
          archivedMessages: null,
        });
      });
    }
    if (cached.length > boundaryIndices.length) {
      sessionsDb.pruneCompactionEpochsAfter(cacheSessionId, boundaryIndices.length);
    }
  } catch {
    // Cache only — filtering decisions always re-derive from the transcript.
  }
}

/**
 * Shared normalization + pagination for `fetchHistory` and the fork snapshot
 * reader. Accepts a bound `normalizeMessage` so both paths produce identical
 * frontend-facing message shapes for the same raw transcript.
 *
 * REQ-052: boundaries are located in FILE ORDER first, then the requested
 * viewport (`view`) selects which raw segment is normalized — the archived
 * past is only read when someone actually asks for it.
 */
function normalizeClaudeRawMessages(
  rawMessages: AnyRecord[],
  sessionId: string,
  limit: number | null,
  offset: number,
  normalizeMessage: (rawMessage: unknown, sessionId: string | null) => NormalizedMessage[],
  viewOptions: { view?: CompactionView; epoch?: number; cacheSessionId?: string | null } = {},
): FetchHistoryResult {
  const view: CompactionView = viewOptions.view ?? 'all';
  const normalizedOffset = Math.max(0, offset);
  const normalizedLimit = limit === null ? null : Math.max(0, limit);

  const boundaryIndices = findBoundaryIndices(rawMessages);
  const lastBoundaryIndex = boundaryIndices.length > 0 ? boundaryIndices[boundaryIndices.length - 1] : -1;
  const hasArchived = boundaryIndices.length > 0;

  let segment: AnyRecord[];
  let epochInfo: CompactionEpochInfo | undefined;
  let cacheThisScan = false;

  if (view === 'archived') {
    // Out-of-range epochs yield an empty page; the viewer clamps via the
    // compactions listing so this only happens on concurrent truncation.
    const requestedEpoch = viewOptions.epoch ?? boundaryIndices.length;
    const bounds = epochSegmentBounds(boundaryIndices, requestedEpoch);
    segment = bounds ? rawMessages.slice(bounds.start, bounds.end) : [];
    epochInfo = bounds ? { ...buildEpochInfo(rawMessages, boundaryIndices, requestedEpoch), archivedMessages: null } : undefined;
  } else {
    const start = view === 'active' && lastBoundaryIndex !== -1 ? lastBoundaryIndex : 0;
    segment = rawMessages.slice(start);
    if (hasArchived) {
      epochInfo = buildEpochInfo(rawMessages, boundaryIndices, boundaryIndices.length);
      cacheThisScan = true;
    }
  }

  const { messages: normalized, total } = normalizeRawSegment(segment, sessionId, normalizeMessage);
  if (view === 'archived' && epochInfo) {
    epochInfo.archivedMessages = total;
  }
  if (cacheThisScan) {
    cacheEpochs(rawMessages, boundaryIndices, viewOptions.cacheSessionId ?? null);
  }

  const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

  return {
    messages: page,
    total,
    hasMore,
    offset: normalizedOffset,
    limit: normalizedLimit,
    view,
    hasArchived,
    ...(epochInfo ? { compaction: epochInfo } : {}),
  };
}

export class ClaudeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes one Claude JSONL entry or live SDK stream event into the shared
   * message shape consumed by REST and WebSocket clients.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    if (raw.type === 'content_block_delta' && raw.delta?.text) {
      return [createNormalizedMessage({ kind: 'stream_delta', content: raw.delta.text, sessionId, provider: PROVIDER })];
    }
    if (raw.type === 'content_block_stop') {
      return [createNormalizedMessage({ kind: 'stream_end', sessionId, provider: PROVIDER })];
    }

    /**
     * REQ-052: the SDK announces context compaction as a system event. Surface
     * it so the chat UI can swap to the compacted viewport live; history reads
     * instead detect the boundary from the `isCompactSummary` transcript row.
     */
    if (raw.type === 'system' && raw.subtype === 'compact_boundary') {
      const metadata = readObjectRecord(raw.compact_metadata);
      return [createNormalizedMessage({
        kind: 'compact_boundary',
        sessionId,
        provider: PROVIDER,
        timestamp: raw.timestamp || new Date().toISOString(),
        compactTrigger: typeof metadata?.trigger === 'string' ? metadata.trigger : null,
        preTokens: typeof metadata?.pre_tokens === 'number' ? metadata.pre_tokens : null,
      })];
    }

    const messages: NormalizedMessage[] = [];
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('claude');

    if (raw.message?.role === 'user' && raw.message?.content && raw.isMeta !== true) {
      if (Array.isArray(raw.message.content)) {
        for (let partIndex = 0; partIndex < raw.message.content.length; partIndex++) {
          const part = raw.message.content[partIndex];
          if (part.type === 'tool_result') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_tr_${part.tool_use_id}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_result',
              toolId: part.tool_use_id,
              content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
              isError: Boolean(part.is_error),
              subagentTools: raw.subagentTools,
              toolUseResult: raw.toolUseResult,
            }));
          } else if (part.type === 'text') {
            const text = part.text || '';
            if (text && !isInternalContent(text)) {
              messages.push(createNormalizedMessage({
                id: `${baseId}_text_${partIndex}`,
                sessionId,
                timestamp: ts,
                provider: PROVIDER,
                kind: 'text',
                role: 'user',
                content: text,
              }));
            }
          }
        }

        if (messages.length === 0) {
          const textParts = raw.message.content
            .filter((part: AnyRecord) => part.type === 'text')
            .map((part: AnyRecord) => part.text)
            .filter(Boolean)
            .join('\n');
          if (textParts && !isInternalContent(textParts)) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_text`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content: textParts,
            }));
          }
        }
      } else if (typeof raw.message.content === 'string') {
        const text = raw.message.content;

        /**
         * Claude stores compact summaries as synthetic "user" rows so the CLI
         * can resume the next session turn with the summary in-context.
         *
         * For the web UI this is much more useful as assistant-authored summary
         * text; otherwise it is both filtered by the generic internal-prefix
         * check and visually mislabeled as a user message.
         */
        if (raw.isCompactSummary === true && text.trim()) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: text,
            isCompactSummary: true,
          }));
          return messages;
        }

        /**
         * Local slash commands are serialized as tagged text even though they
         * are semantically a user action. Expose the parsed fields to the
         * frontend and emit a plain user-visible command string so the command
         * no longer disappears from history.
         */
        const localCommandPayload = parseLocalCommandPayload(text);
        if (localCommandPayload) {
          const displayText = buildLocalCommandDisplayText(localCommandPayload);
          if (displayText) {
            messages.push(createNormalizedMessage({
              id: baseId,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'user',
              content: displayText,
              commandName: localCommandPayload.commandName,
              commandMessage: localCommandPayload.commandMessage,
              commandArgs: localCommandPayload.commandArgs,
              isLocalCommand: true,
            }));
          }
          return messages;
        }

        /**
         * Local command stdout is also written as a "user" row in Claude's
         * transcript, but it is terminal output produced in response to the
         * command. Re-label it as assistant text so the chat transcript matches
         * the actual conversational flow seen by the user.
         */
        const localCommandStdout = extractTaggedContent(text, 'local-command-stdout');
        if (localCommandStdout !== null) {
          const stdoutText = stripAnsiFormatting(localCommandStdout).trim();
          if (stdoutText) {
            messages.push(createNormalizedMessage({
              id: baseId,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: stdoutText,
              isLocalCommandStdout: true,
            }));
          }
          return messages;
        }

        if (text && !isInternalContent(text)) {
          messages.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'user',
            content: text,
          }));
        }
      }
      return messages;
    }

    if (raw.type === 'thinking' && raw.message?.content) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: raw.message.content,
      }));
      return messages;
    }

    if (raw.type === 'tool_use' && raw.toolName) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName,
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
      }));
      return messages;
    }

    if (raw.type === 'tool_result') {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: false,
      }));
      return messages;
    }

    if (raw.message?.role === 'assistant' && raw.message?.content) {
      if (Array.isArray(raw.message.content)) {
        let partIndex = 0;
        for (const part of raw.message.content) {
          if (part.type === 'text' && part.text) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'text',
              role: 'assistant',
              content: part.text,
            }));
          } else if (part.type === 'tool_use') {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: part.name,
              toolInput: part.input,
              toolId: part.id,
            }));
          } else if (part.type === 'thinking' && part.thinking) {
            messages.push(createNormalizedMessage({
              id: `${baseId}_${partIndex}`,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'thinking',
              content: part.thinking,
            }));
          }
          partIndex++;
        }
      } else if (typeof raw.message.content === 'string') {
        messages.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.message.content,
        }));
      }
      return messages;
    }

    return messages;
  }

  /**
   * Loads Claude JSONL history for a project/session and returns normalized
   * messages, preserving the existing pagination behavior from projects.js.
   *
   * REQ-052: `options.view` selects the compaction viewport (`all` default
   * keeps the legacy whole-transcript contract; `active`/`archived` read only
   * the requested segment).
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0, view = 'all', epoch } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;

    let rawMessages: AnyRecord[];
    try {
      // Load raw rows in file order first so `total` reflects frontend-normalized
      // messages, not raw JSONL records.
      rawMessages = await getSessionMessages(sessionId, providerSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ClaudeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    return normalizeClaudeRawMessages(rawMessages, sessionId, limit, offset, this.normalizeMessage.bind(this), {
      view,
      epoch,
      cacheSessionId: sessionId,
    });
  }

  /**
   * REQ-052: one transcript scan resolving every compaction epoch.
   *
   * 复盘修正: exact archived counts are expensive — computing them means
   * normalizing the whole compacted-away past, the very O(N) work this REQ
   * set out to avoid. Counts are therefore served from the
   * `session_compactions` cache whenever the cached epoch set still matches
   * the transcript boundaries; only new/changed epochs are recomputed.
   * Caching a count is safe because an epoch's segment is closed: rows are
   * appended at the end of the file, never before an existing boundary.
   */
  async listCompactions(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'providerSessionId'> = {},
  ): Promise<CompactionEpochInfo[]> {
    const providerSessionId = options.providerSessionId ?? sessionId;
    const rawMessages = await getSessionMessages(sessionId, providerSessionId);
    const boundaryIndices = findBoundaryIndices(rawMessages);

    let cached: CachedCompactionEpochRow[] = [];
    try {
      cached = sessionsDb.listCompactionEpochs(sessionId);
    } catch {
      // Cache only — fall through and compute everything from the scan.
    }
    const cachedByEpoch = new Map(cached.map((row) => [row.epoch, row]));

    const epochs: CompactionEpochInfo[] = [];
    for (let epoch = 1; epoch <= boundaryIndices.length; epoch++) {
      const raw = rawMessages[boundaryIndices[epoch - 1]];
      const boundaryTimestamp = boundaryTimestampOf(raw);

      const cachedRow = cachedByEpoch.get(epoch);
      if (cachedRow && cachedRowMatchesBoundary(cachedRow, raw) && cachedRow.archived_messages !== null) {
        epochs.push({
          epoch,
          boundaryTimestamp,
          archivedMessages: cachedRow.archived_messages,
          trigger: cachedRow.trigger,
        });
        continue;
      }

      const bounds = epochSegmentBounds(boundaryIndices, epoch);
      const archivedMessages = bounds
        ? normalizeRawSegment(rawMessages.slice(bounds.start, bounds.end), sessionId, this.normalizeMessage.bind(this)).total
        : null;
      epochs.push({
        epoch,
        boundaryTimestamp,
        archivedMessages,
        trigger: null,
      });
      try {
        sessionsDb.upsertCompactionEpoch({
          sessionId,
          epoch,
          boundaryUuid: boundaryUuidOf(raw),
          boundaryTimestamp,
          trigger: null,
          preTokens: null,
          archivedMessages,
        });
      } catch {
        // Cache only — a failed write must not hide real history.
      }
    }

    if (cached.length > boundaryIndices.length) {
      try {
        sessionsDb.pruneCompactionEpochsAfter(sessionId, boundaryIndices.length);
      } catch {
        // Cache only — ghost rows are invisible to this response either way.
      }
    }

    return epochs;
  }

  /**
   * REQ-049 fork: reads a copied transcript snapshot straight from disk (no
   * provider_session_id filter — the copy is an app-controlled whole-file
   * snapshot). Shares normalization with `fetchHistory` so the forked view is
   * byte-for-byte identical to the original conversation. Forks keep the
   * legacy whole-transcript viewport (fork = full copy semantics).
   */
  async fetchHistoryByJsonlPath(
    jsonlPath: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const forkSessionId = path.basename(jsonlPath, '.jsonl');

    let rawMessages: AnyRecord[] = [];
    try {
      rawMessages = await readJsonlFileRaw(jsonlPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ClaudeProvider] Failed to load fork snapshot ${jsonlPath}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    return normalizeClaudeRawMessages(rawMessages, forkSessionId, limit, offset, this.normalizeMessage.bind(this), {
      view: 'all',
      cacheSessionId: null,
    });
  }

  /**
   * Message-level fork: truncate the transcript at the record whose timestamp
   * reaches upToTimestamp. Claude records carry an ISO `timestamp` field;
   * metadata rows (mode/permission-mode/summary without timestamp) are treated
   * as "before" and preserved up to the truncation point. Lines after the match
   * (including trailing ai-title rows) are dropped — they belong to later turns.
   */
  async forkJsonlByMessage(
    sourceJsonlPath: string,
    targetPath: string,
    upToTimestamp: number | string,
  ): Promise<void> {
    await truncateJsonlByTimestamp(sourceJsonlPath, targetPath, upToTimestamp, (line) => {
      const ts = line.timestamp;
      if (typeof ts !== 'string' && typeof ts !== 'number') return null;
      const ms = typeof ts === 'number' ? (ts < 1_000_000_000_000 ? ts * 1000 : ts) : Date.parse(ts);
      return Number.isFinite(ms) ? ms : null;
    });
  }
}
