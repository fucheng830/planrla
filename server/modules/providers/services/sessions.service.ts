import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { filterSilentRenameTurns } from '@/shared/rename-command-filter.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
};

type ForkSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  jsonlPath: string;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */

type SessionRowLike = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
  jsonl_path: string | null;
};

/**
 * REQ-049 fork: reads a copied transcript snapshot directly from disk for a
 * session that has no provider_session_id yet (brand-new fork). Provider
 * readers expose an optional `fetchHistoryByJsonlPath`; providers that do not
 * implement it simply return an empty history (fork still opens, history blank).
 * Silent rename turns (REQ-030) are stripped so a forked snapshot never surfaces
 * them either.
 */
async function readForkHistory(
  session: SessionRowLike,
  options: Pick<FetchHistoryOptions, 'limit' | 'offset'>,
): Promise<FetchHistoryResult> {
  const empty: FetchHistoryResult = {
    messages: [],
    total: 0,
    hasMore: false,
    offset: options.offset ?? 0,
    limit: options.limit ?? null,
  };
  if (!session.jsonl_path) {
    return empty;
  }

  const provider = session.provider as LLMProvider;
  const reader = providerRegistry.resolveProvider(provider).sessions;
  if (typeof reader.fetchHistoryByJsonlPath !== 'function') {
    return empty;
  }

  try {
    const result = await reader.fetchHistoryByJsonlPath(session.jsonl_path, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
    });
    return {
      ...result,
      messages: filterSilentRenameTurns(result.messages).map((message) => ({
        ...message,
        sessionId: session.session_id,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[sessionsService] fork history read failed for ${session.session_id}:`, message);
    return empty;
  }
}

/** Optional extra source of running sessions for non-chat spawns (kanban). */
export type ExternalRunningSessionsSource = () => Array<{
  sessionId: string;
  provider: LLMProvider;
  startedAt: number;
  lastSeq: number;
}>;
let externalRunningSource: ExternalRunningSessionsSource | null = null;

export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   *
   * Runs spawned outside the chat websocket (kanban agent stages) never enter
   * chatRunRegistry — they are merged in from the registered external source
   * (see registerExternalRunningSessions) so the sidebar / inbox still show
   * them as running.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    const runs = chatRunRegistry.listRunningRuns();
    let external: Array<{ sessionId: string; provider: LLMProvider; startedAt: number; lastSeq: number }> = [];
    try {
      external = externalRunningSource?.() ?? [];
    } catch (error) {
      console.warn('[sessionsService] external running source failed:', error);
    }
    const seen = new Set(runs.map((run) => run.sessionId));
    return [...runs, ...external.filter((item) => !seen.has(item.sessionId))];
  },

  /**
   * Registers a provider of "running sessions" for runs spawned outside the
   * chat websocket. The kanban assembly uses this so agent-stage sessions
   * surface as running; returning [] keeps the chat-only behavior. Must be
   * idempotent-safe (last registration wins).
   */
  registerExternalRunningSessions(source: ExternalRunningSessionsSource | null): void {
    externalRunningSource = source;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run.
   */
  createAppSession(provider: LLMProvider, projectPath: string): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
    };
  },

  /**
   * REQ-049 fork: copies a conversation's full transcript into a brand-new app
   * session so the user can branch off without touching the original.
   *
   * The new row keeps the same provider and project_path, starts with
   * provider_session_id = NULL (the first message after fork spawns a fresh
   * provider-native session — Codex-faithful semantics), and points
   * jsonl_path at the streamed copy of the source transcript. The original
   * session row and transcript file are never mutated.
   */
  async forkSession(sourceSessionId: string, upToTimestamp?: number | string): Promise<ForkSessionResult> {
    const source = sessionsDb.getSessionById(sourceSessionId);
    if (!source) {
      throw new AppError(`Session "${sourceSessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // Sessions whose transcript has not been written to disk yet (e.g. a
    // brand-new chat whose first message is still streaming) have nothing to
    // fork — refusing here keeps the forked conversation from opening empty.
    if (!source.jsonl_path) {
      throw new AppError(
        `Session "${sourceSessionId}" has no transcript yet and cannot be forked.`,
        { code: 'SESSION_NOT_FORKABLE', statusCode: 409 },
      );
    }

    const provider = source.provider as LLMProvider;
    const projectPath = source.project_path ?? '';
    const newSessionId = randomUUID();

    // createAppSession inserts the row (provider_session_id=NULL, jsonl_path=NULL)
    // and ensures the project path exists, mirroring the brand-new chat path.
    sessionsDb.createAppSession(newSessionId, provider, projectPath);

    // Copy the transcript into the same project directory so the provider's
    // session-synchronizer/watcher ignores it (it only scans known provider
    // file-name shapes). When upToTimestamp is set, delegate to the provider's
    // forkJsonlByMessage to truncate at the matching message; otherwise stream-
    // copy the whole file (libuv thread, does not load into memory).
    const forkedJsonlPath = path.join(path.dirname(source.jsonl_path), `${newSessionId}.jsonl`);
    try {
      if (upToTimestamp !== undefined) {
        const reader = providerRegistry.resolveProvider(provider).sessions;
        if (typeof reader.forkJsonlByMessage === 'function') {
          await reader.forkJsonlByMessage(source.jsonl_path, forkedJsonlPath, upToTimestamp);
        } else {
          // Provider has no message-level truncation: fall back to whole-file
          // copy so fork still works (history will be the full conversation).
          console.warn(
            `[sessionsService] provider "${provider}" has no forkJsonlByMessage; falling back to full copy for ${sourceSessionId}`,
          );
          await fsp.copyFile(source.jsonl_path, forkedJsonlPath);
        }
      } else {
        await fsp.copyFile(source.jsonl_path, forkedJsonlPath);
      }
    } catch (error) {
      // Roll back the optimistic DB row so a failed copy never leaves an empty
      // session behind.
      sessionsDb.deleteSessionById(newSessionId);
      throw error;
    }

    sessionsDb.updateSessionJsonlPath(newSessionId, forkedJsonlPath);

    const sourceName = source.custom_name?.trim();
    if (sourceName) {
      sessionsDb.updateSessionCustomName(newSessionId, `${sourceName} · fork`);
    }

    return {
      sessionId: newSessionId,
      provider,
      projectPath,
      jsonlPath: forkedJsonlPath,
    };
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */

  /** Resolve the app-facing session id from a provider-native session id. */
  resolveAppSessionIdByProviderSessionId(provider: string, providerSessionId: string): string | null {
    return sessionsDb.getAppSessionIdByProviderSessionId(provider, providerSessionId);
  },


  async fetchHistory(    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history.
    if (!session.provider_session_id) {
      // REQ-049 fork: an app session with provider_session_id IS NULL but a
      // jsonl_path set is a forked conversation whose history is the copied
      // transcript snapshot. Read it directly (no provider id to filter on).
      if (session.jsonl_path) {
        return readForkHistory(session, options);
      }
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: options.offset ?? 0,
        limit: options.limit ?? null,
      };
    }

    const provider = session.provider as LLMProvider;
    const result = await providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
      projectPath: session.project_path ?? '',
      providerSessionId: session.provider_session_id,
    });

    return {
      ...result,
      // REQ-030: strip silent rename turns (auto-rename hint + assistant reply
      // + set_session_title tool_use/tool_result) before remapping ids, so
      // neither REST nor MCP history consumers ever surface them on reload.
      // The provider runtime persists the synthetic turn to the transcript on
      // disk; this read-side filter makes it invisible without touching writes.
      messages: filterSilentRenameTurns(result.messages).map((message) => ({
        ...message,
        sessionId,
      })),
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk && session.jsonl_path) {
      removedFromDisk = await removeFileIfExists(session.jsonl_path);
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },

  /**
   * Flips `sessions.isPinned` for one session and returns the new state.
   * Pinned sessions sort before unpinned ones in the sidebar.
   */
  toggleSessionPin(sessionId: string): { sessionId: string; isPinned: boolean } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const nextPinnedState = !Boolean(session.isPinned);
    sessionsDb.updateSessionIsPinned(sessionId, nextPinnedState);

    return { sessionId, isPinned: nextPinnedState };
  },
};
