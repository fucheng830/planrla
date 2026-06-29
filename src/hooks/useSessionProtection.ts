import { useCallback, useState } from 'react';
import type { SessionTaskStatus } from '../shared/taskStatus';

export interface SessionActivity {
  taskStatus: Extract<SessionTaskStatus, 'running' | 'waiting_for_input'>;
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   */
  startedAt: number;
}

export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

export interface CompletedSessionNotification {
  completedAt: number;
  status: Extract<SessionTaskStatus, 'completed' | 'failed' | 'needs_attention'>;
}

export type CompletedSessionNotificationMap = ReadonlyMap<string, CompletedSessionNotification>;

export type SessionActivitySnapshot = {
  sessionId: string;
  taskStatus?: SessionTaskStatus;
  statusText?: string | null;
  canInterrupt?: boolean;
  startedAt?: number;
};

export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: {
    taskStatus?: Extract<SessionTaskStatus, 'running' | 'waiting_for_input'>;
    statusText?: string | null;
    canInterrupt?: boolean;
  },
) => void;

export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => void;

export type MarkSessionCompleted = (
  sessionId?: string | null,
  status?: Extract<SessionTaskStatus, 'completed' | 'failed' | 'needs_attention'>,
) => void;

export type ClearSessionCompleted = (sessionId?: string | null) => void;

export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
) => void;

const LOCAL_ACTIVITY_GRACE_MS = 10_000;

const sessionActivityMapsMatch = (
  left: ReadonlyMap<string, SessionActivity>,
  right: ReadonlyMap<string, SessionActivity>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const [sessionId, leftActivity] of left) {
    const rightActivity = right.get(sessionId);
    if (
      !rightActivity
      || leftActivity.taskStatus !== rightActivity.taskStatus
      || leftActivity.statusText !== rightActivity.statusText
      || leftActivity.canInterrupt !== rightActivity.canInterrupt
      || leftActivity.startedAt !== rightActivity.startedAt
    ) {
      return false;
    }
  }

  return true;
};

/**
 * Single source of truth for which sessions are actively processing a
 * request. Everything the chat UI shows (activity indicator, abort
 * availability, status text) is derived from this map; terminal events
 * (`complete`, abort, an authoritative idle subscribe ack) delete the entry
 * atomically. Session ids are always concrete (allocated before the first
 * send), so entries are keyed by real session ids only.
 */
export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(
    new Map(),
  );
  const [completedSessions, setCompletedSessions] = useState<Map<string, CompletedSessionNotification>>(
    new Map(),
  );

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, activity) => {
    if (!sessionId) {
      return;
    }

    setCompletedSessions((prev) => {
      if (!prev.has(sessionId)) {
        return prev;
      }

      const updated = new Map(prev);
      updated.delete(sessionId);
      return updated;
    });

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      const next: SessionActivity = {
        taskStatus: activity?.taskStatus ?? existing?.taskStatus ?? 'running',
        statusText:
          activity?.statusText !== undefined ? activity.statusText : existing?.statusText ?? null,
        canInterrupt: activity?.canInterrupt ?? existing?.canInterrupt ?? true,
        startedAt: existing?.startedAt ?? Date.now(),
      };

      if (
        existing
        && existing.taskStatus === next.taskStatus
        && existing.statusText === next.statusText
        && existing.canInterrupt === next.canInterrupt
      ) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, next);
      return updated;
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, opts) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      const existing = prev.get(sessionId);
      if (!existing) {
        return prev;
      }

      // Guard against stale `chat_subscribed` idle acks: if a new request
      // started after the subscribe was sent, the idle ack describes the
      // older request and must not clear the newer one.
      if (opts?.ifStartedBefore !== undefined && existing.startedAt >= opts.ifStartedBefore) {
        return prev;
      }

      const updated = new Map(prev);
      updated.delete(sessionId);
      return updated;
    });
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((sessions) => {
    const now = Date.now();

    setProcessingSessions((prev) => {
      const incoming = new Map<string, SessionActivitySnapshot>();
      for (const session of sessions) {
        if (!session.sessionId) {
          continue;
        }
        incoming.set(session.sessionId, session);
      }

      const updated = new Map<string, SessionActivity>();

      for (const [sessionId, snapshot] of incoming) {
        const existing = prev.get(sessionId);
        const snapshotStartedAt =
          typeof snapshot.startedAt === 'number' && Number.isFinite(snapshot.startedAt) && snapshot.startedAt > 0
            ? snapshot.startedAt
            : undefined;

        updated.set(sessionId, {
          taskStatus:
            snapshot.taskStatus === 'waiting_for_input'
              ? 'waiting_for_input'
              : existing?.taskStatus ?? 'running',
          statusText:
            snapshot.statusText !== undefined ? snapshot.statusText : existing?.statusText ?? null,
          canInterrupt: snapshot.canInterrupt ?? existing?.canInterrupt ?? true,
          startedAt: snapshotStartedAt ?? existing?.startedAt ?? now,
        });
      }

      for (const [sessionId, activity] of prev) {
        if (!incoming.has(sessionId) && now - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) {
          updated.set(sessionId, activity);
        }
      }

      return sessionActivityMapsMatch(prev, updated) ? prev : updated;
    });
  }, []);

  const markSessionCompleted = useCallback<MarkSessionCompleted>((sessionId, status = 'completed') => {
    if (!sessionId) {
      return;
    }

    setCompletedSessions((prev) => {
      const completedAt = Date.now();
      const existing = prev.get(sessionId);
      if (existing && existing.status === status && completedAt - existing.completedAt < 1000) {
        return prev;
      }

      const updated = new Map(prev);
      updated.set(sessionId, { completedAt, status });
      return updated;
    });
  }, []);

  const clearSessionCompleted = useCallback<ClearSessionCompleted>((sessionId) => {
    if (!sessionId) {
      return;
    }

    setCompletedSessions((prev) => {
      if (!prev.has(sessionId)) {
        return prev;
      }

      const updated = new Map(prev);
      updated.delete(sessionId);
      return updated;
    });
  }, []);

  return {
    processingSessions,
    completedSessions,
    markSessionProcessing,
    markSessionIdle,
    markSessionCompleted,
    clearSessionCompleted,
    syncProcessingSessions,
  };
}
