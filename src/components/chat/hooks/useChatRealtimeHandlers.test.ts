import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { applyChatEvent } from './useChatRealtimeHandlers';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { LLMProvider } from '../../../types/app';
import type { SessionStore } from '../../../stores/useSessionStore';
import type { BatchEntry } from '../utils/batchBySession';
import type { PendingPermissionRequest } from '../types/types';

// The non-silent stream_delta path schedules a debounced store update via
// `window.setTimeout`. Node has no `window`; stub just enough for that one
// regression test. Silent paths never touch `window`, so they run before this
// stub is needed.
const originalWindow = (globalThis as { window?: unknown }).window;
before(() => {
  (globalThis as { window?: unknown }).window = {
    setTimeout: (() => 0) as unknown as typeof window.setTimeout,
  } as unknown as typeof window;
});
after(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

const SID = 'sess-1';
const PROVIDER = 'claude' as LLMProvider;

interface CtxInit {
  provider?: LLMProvider;
  activeViewSessionId?: string | null;
  sessionStore?: Partial<SessionStore>;
  onSessionProcessing?: ReturnType<typeof makeStub>;
  onSessionIdle?: ReturnType<typeof makeStub>;
  onSessionCompleted?: ReturnType<typeof makeStub>;
  onSilentRunCompleted?: ReturnType<typeof makeStub>;
  refreshFromServer?: ReturnType<typeof makeStub>;
  appendRealtime?: ReturnType<typeof makeStub>;
  appendRealtimeBatch?: ReturnType<typeof makeStub>;
  updateStreaming?: ReturnType<typeof makeStub>;
  finalizeStreaming?: ReturnType<typeof makeStub>;
  playChatCompletionSound?: ReturnType<typeof makeStub>;
  showCompletionTitleIndicator?: ReturnType<typeof makeStub>;
}

// `applyChatEvent` lives in a module that also imports browser-only helpers
// (notificationSound, pageTitleNotification). Those modules short-circuit when
// their side-effects aren't reachable, but to keep the test deterministic we
// never reach them on silent paths. The stubs below record calls so the test
// can assert "not called".
function makeStub(): ((...args: unknown[]) => unknown) & { calls: unknown[][] } {
  const fn = (...args: unknown[]) => {
    fn.calls.push(args);
  };
  fn.calls = [] as unknown[][];
  return fn as unknown as ((...args: unknown[]) => unknown) & { calls: unknown[][] };
}

function makeCtx(overrides: CtxInit = {}) {
  const sessionStore = {
    appendRealtime: overrides.appendRealtime ?? makeStub(),
    appendRealtimeBatch: overrides.appendRealtimeBatch ?? makeStub(),
    updateStreaming: overrides.updateStreaming ?? makeStub(),
    finalizeStreaming: overrides.finalizeStreaming ?? makeStub(),
    refreshFromServer: overrides.refreshFromServer ?? makeStub(),
  } as unknown as SessionStore;

  return {
    provider: overrides.provider ?? PROVIDER,
    activeViewSessionId: overrides.activeViewSessionId ?? SID,
    accumulatedStream: { current: '' },
    streamTimer: { current: null },
    firstTokenLogged: { current: false },
    batchQueue: { current: [] as BatchEntry[] },
    pendingPermissionRequestsRef: { current: [] as PendingPermissionRequest[] },
    sessionStore,
    onSessionProcessing: overrides.onSessionProcessing ?? makeStub(),
    onSessionIdle: overrides.onSessionIdle ?? makeStub(),
    onSessionCompleted: overrides.onSessionCompleted ?? makeStub(),
    onSilentRunCompleted: overrides.onSilentRunCompleted,
    setPendingPermissionRequests: makeStub(),
    setTokenBudget: makeStub(),
    onWebSocketReconnect: makeStub(),
    // rAF/timer plumbing — silent paths never touch them, but the function
    // signature still expects them. Provide inert stubs.
    flushBatch: makeStub(),
    flushPendingBatch: makeStub(),
    scheduleFlush: makeStub(),
    lastSeqRef: { current: new Map<string, number>() },
    statusCheckSentAtRef: { current: new Map<string, number>() },
  };
}

// --- Silent guards: stream_delta / stream_end / complete ---

test('silent stream_delta: not appended to store, streaming not updated', () => {
  const ctx = makeCtx();
  const event: ServerEvent = {
    kind: 'stream_delta', sessionId: SID, content: 'hi', silent: true,
  };
  applyChatEvent(event, ctx);
  assert.equal((ctx.sessionStore.appendRealtime as unknown as { calls: unknown[][] }).calls.length, 0);
  assert.equal((ctx.sessionStore.updateStreaming as unknown as { calls: unknown[][] }).calls.length, 0);
});

test('silent stream_end: streaming not finalized, accumulated stream untouched', () => {
  const ctx = makeCtx();
  ctx.accumulatedStream.current = 'partial';
  const event: ServerEvent = { kind: 'stream_end', sessionId: SID, silent: true };
  applyChatEvent(event, ctx);
  assert.equal((ctx.sessionStore.finalizeStreaming as unknown as { calls: unknown[][] }).calls.length, 0);
  assert.equal((ctx.sessionStore.updateStreaming as unknown as { calls: unknown[][] }).calls.length, 0);
  // accumulated stream is NOT reset on silent (no UI took notice of it)
  assert.equal(ctx.accumulatedStream.current, 'partial');
});

test('silent complete: no bell / no refresh / no idle / no completion badge', () => {
  const onIdle = makeStub();
  const onCompleted = makeStub();
  const ctx = makeCtx({
    onSessionIdle: onIdle,
    onSessionCompleted: onCompleted,
  });
  const event: ServerEvent = {
    kind: 'complete', sessionId: SID, success: true, silent: true,
  };
  applyChatEvent(event, ctx);

  // No UI side-effects
  assert.equal((ctx.sessionStore.refreshFromServer as unknown as { calls: unknown[][] }).calls.length, 0);
  assert.equal((ctx.sessionStore.finalizeStreaming as unknown as { calls: unknown[][] }).calls.length, 0);
  assert.equal(onIdle.calls.length, 0, 'onSessionIdle must not fire for silent');
  assert.equal(onCompleted.calls.length, 0, 'onSessionCompleted (badge) must not fire for silent');
});

test('silent complete: fires onSilentRunCompleted with sid + success', () => {
  const onSilent = makeStub();
  const ctx = makeCtx({ onSilentRunCompleted: onSilent });
  const event: ServerEvent = {
    kind: 'complete', sessionId: SID, success: true, silent: true,
  };
  applyChatEvent(event, ctx);
  assert.equal(onSilent.calls.length, 1);
  assert.deepEqual(onSilent.calls[0], [SID, true]);
});

test('silent complete (success:false): onSilentRunCompleted receives success=false', () => {
  const onSilent = makeStub();
  const ctx = makeCtx({ onSilentRunCompleted: onSilent });
  const event: ServerEvent = {
    kind: 'complete', sessionId: SID, success: false, silent: true,
  };
  applyChatEvent(event, ctx);
  assert.equal(onSilent.calls.length, 1);
  assert.deepEqual(onSilent.calls[0], [SID, false]);
});

test('silent complete without onSilentRunCompleted wired: still no UI side-effects, no throw', () => {
  const ctx = makeCtx(); // onSilentRunCompleted undefined
  const event: ServerEvent = {
    kind: 'complete', sessionId: SID, success: true, silent: true,
  };
  // Should not throw
  applyChatEvent(event, ctx);
  assert.equal((ctx.sessionStore.refreshFromServer as unknown as { calls: unknown[][] }).calls.length, 0);
});

// --- Non-silent events still route normally (regression guard) ---

test('non-silent complete: fires onSessionCompleted (badge) + refreshFromServer', () => {
  const onCompleted = makeStub();
  const ctx = makeCtx({ onSessionCompleted: onCompleted });
  const event: ServerEvent = {
    kind: 'complete', sessionId: SID, success: true,
  };
  applyChatEvent(event, ctx);
  assert.equal(onCompleted.calls.length, 1);
  assert.equal((ctx.sessionStore.refreshFromServer as unknown as { calls: unknown[][] }).calls.length, 1);
});

test('non-silent stream_delta with content: updates streaming for active session', () => {
  const ctx = makeCtx();
  const event: ServerEvent = {
    kind: 'stream_delta', sessionId: SID, content: 'token',
  };
  applyChatEvent(event, ctx);
  // accumulated stream grew
  assert.equal(ctx.accumulatedStream.current, 'token');
});
