import type { AnyRecord, LLMProvider } from '@/shared/types.js';

/**
 * Shared types for the chat websocket message handlers. Kept apart from
 * chat-websocket.service.ts so per-message handler files (e.g. the REQ-052
 * chat.compact handler) can depend on the dependency-injection shape without
 * importing the dispatcher itself.
 */

/**
 * One provider runtime entry point. All five runtimes share this signature,
 * which lets the chat handler dispatch through a provider-keyed map instead
 * of provider-specific branches.
 */
export type ProviderSpawnFn = (
  command: string,
  options: AnyRecord,
  writer: unknown
) => Promise<unknown>;

export type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions keyed by provider id. They are addressed with the
   * provider-native session id (that is how runtimes key their process maps).
   * The Claude abort is async; the rest are sync — both shapes are accepted.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  resolveToolApproval: (
    requestId: string,
    payload: {
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }
  ) => void;
  /** Claude-only today: pending tool approvals included in `chat_subscribed`. */
  getPendingApprovalsForSession: (providerSessionId: string) => unknown[];
};
