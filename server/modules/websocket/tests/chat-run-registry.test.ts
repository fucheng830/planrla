import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Minimal stand-in for a websocket connection: collects every JSON frame the
 * gateway writer forwards so assertions can inspect the outbound protocol.
 */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-registry-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('live events are remapped to the app session id and sequenced', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-1', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: 'user-1',
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'provider-id-9', content: 'hello' });
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'provider-id-9', content: 'hello world' });

    assert.equal(connection.frames.length, 2);
    assert.equal(connection.frames[0]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[0]?.seq, 1);
    assert.equal(connection.frames[1]?.sessionId, 'app-run-1');
    assert.equal(connection.frames[1]?.seq, 2);
  });
});

test('session_created is swallowed and persisted as the provider-id mapping', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-2', 'cursor', '/workspace/demo');
    const connection = new FakeConnection();
    connectedClients.add(connection as never);
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-2',
      provider: 'cursor',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({
      kind: 'session_created',
      provider: 'cursor',
      sessionId: 'cursor-native-7',
      newSessionId: 'cursor-native-7',
    });

    // The provider-native event itself is never forwarded...
    const sessionUpserts = connection.frames.filter((frame) => frame.kind === 'session_upserted');
    assert.equal(sessionUpserts.length, 1);
    assert.equal(sessionUpserts[0]?.sessionId, 'app-run-2');
    assert.equal(sessionUpserts[0]?.providerSessionId, 'cursor-native-7');
    // ...but the canonical mapping is recorded and persisted in the database.
    assert.equal(run.providerSessionId, 'cursor-native-7');
    assert.equal(sessionsDb.getSessionById('app-run-2')?.provider_session_id, 'cursor-native-7');
  });
});

test('complete marks the run finished and duplicate completes are dropped', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-3', 'codex', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-3',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 0 });
    // Late duplicate from a killed runtime's exit handler.
    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-3', exitCode: 1 });

    const completes = connection.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1);
    assert.equal(completes[0]?.actualSessionId, 'app-run-3');
    assert.equal(chatRunRegistry.isProcessing('app-run-3'), false);

    // completeRun is also a no-op once the run already completed.
    chatRunRegistry.completeRun('app-run-3', { exitCode: 1 });
    assert.equal(connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
  });
});

test('listRunningRuns returns only currently running app sessions', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-7', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-run-8', 'codex', '/workspace/demo');
    const connection = new FakeConnection();

    const completedRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-7',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(completedRun);

    const runningRun = chatRunRegistry.startRun({
      appSessionId: 'app-run-8',
      provider: 'codex',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(runningRun);

    chatRunRegistry.completeRun('app-run-7', { exitCode: 0 });

    const runningSessions = chatRunRegistry.listRunningRuns();
    assert.deepEqual(runningSessions.map((session) => session.sessionId), ['app-run-8']);
    assert.equal(runningSessions[0]?.provider, 'codex');
  });
});

test('replayEvents returns only events after the requested seq', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-4', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-4',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'a' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'b' });
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'x', content: 'c' });

    const replayed = chatRunRegistry.replayEvents('app-run-4', 1);
    assert.deepEqual(replayed.map((event) => event.content), ['b', 'c']);
    assert.deepEqual(replayed.map((event) => event.seq), [2, 3]);
  });
});

test('attachConnection reroutes the live stream to a new socket', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-5', 'gemini', '/workspace/demo');
    const firstConnection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-run-5',
      provider: 'gemini',
      providerSessionId: null,
      connection: firstConnection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'gemini', sessionId: 'g', content: 'before' });

    const secondConnection = new FakeConnection();
    assert.equal(chatRunRegistry.attachConnection('app-run-5', secondConnection), true);
    run.writer.send({ kind: 'stream_delta', provider: 'gemini', sessionId: 'g', content: 'after' });

    assert.deepEqual(firstConnection.frames.map((frame) => frame.content), ['before']);
    assert.deepEqual(secondConnection.frames.map((frame) => frame.content), ['after']);
  });
});

test('startRun rejects a second concurrent run for the same session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-run-6', 'opencode', '/workspace/demo');
    const connection = new FakeConnection();
    const first = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(first);

    const second = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.equal(second, null);

    // After the run finishes a new one is allowed again.
    chatRunRegistry.completeRun('app-run-6', { exitCode: 0 });
    const third = chatRunRegistry.startRun({
      appSessionId: 'app-run-6',
      provider: 'opencode',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(third);
  });
});

/* ------------------------------------------------------------------ */
/* REQ-030 silent runs (auto-rename channel)                          */
/*                                                                    */
/* A silent run lives under a separate registry slot (`${sid}:silent`) */
/* so a background auto-rename agent call can run alongside the       */
/* user's normal run for the same session, while staying invisible    */
/* to every UI-facing lookup helper and tagging its outbound frames   */
/* with `silent: true` so the frontend can drop them.                 */
/* ------------------------------------------------------------------ */

test('silent startRun bypasses the per-session single-run mutex', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-silent-1', 'claude', '/workspace/demo');
    const connection = new FakeConnection();

    // A normal run occupies the plain slot — this would normally block a
    // second run for the same session (see previous test).
    const normalRun = chatRunRegistry.startRun({
      appSessionId: 'app-silent-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
      silent: false,
    });
    assert.ok(normalRun);

    // The silent run must NOT be rejected: it lives in a separate slot so a
    // background auto-rename agent call can run while the user's normal run
    // is still finishing/aborted.
    const silentRun = chatRunRegistry.startRun({
      appSessionId: 'app-silent-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
      silent: true,
    });
    assert.ok(silentRun, 'silent run must not be blocked by an in-progress normal run');

    // The silent slot is still mutually exclusive within its own dimension: a
    // second silent run while one is in flight is rejected.
    const secondSilent = chatRunRegistry.startRun({
      appSessionId: 'app-silent-1',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
      silent: true,
    });
    assert.equal(secondSilent, null, 'a second silent run is still mutually exclusive within its own slot');
  });
});

test('silent runs are invisible to the UI-facing lookup helpers', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-silent-2', 'claude', '/workspace/demo');
    const connection = new FakeConnection();

    const silentRun = chatRunRegistry.startRun({
      appSessionId: 'app-silent-2',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
      silent: true,
    });
    assert.ok(silentRun);

    // The plain-key lookups used by chat.subscribe / chat.abort must NOT see
    // the silent run — otherwise a background rename would make the UI show
    // "processing" or replay silent agent output to a reconnecting client.
    assert.equal(chatRunRegistry.isProcessing('app-silent-2'), false);
    assert.equal(chatRunRegistry.getRun('app-silent-2'), undefined);
    assert.deepEqual(chatRunRegistry.replayEvents('app-silent-2', 0), []);

    const running = chatRunRegistry.listRunningRuns();
    assert.deepEqual(
      running.filter((entry) => entry.sessionId === 'app-silent-2'),
      [],
      'silent runs must not appear in listRunningRuns (UI running-sessions indicator)',
    );
  });
});

test('silent run tags every streamed event with silent:true', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-silent-emit', 'claude', '/workspace/demo');
    const silentConnection = new FakeConnection();
    const silentRun = chatRunRegistry.startRun({
      appSessionId: 'app-silent-emit',
      provider: 'claude',
      providerSessionId: null,
      connection: silentConnection,
      userId: null,
      silent: true,
    });
    assert.ok(silentRun);

    // Drive the same emit path the real provider spawn uses: the run's writer
    // (writer.send → decorateOutboundEvent → forward). Every outbound frame a
    // silent run produces must carry silent:true so the frontend (REQ-030
    // Task 3) can detect and drop them without rendering.
    silentRun.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'native', content: 'part' });
    silentRun.writer.send({ kind: 'tool_use', provider: 'claude', sessionId: 'native', toolName: 'set_session_title', toolInput: { title: 'x' } });
    chatRunRegistry.completeRun('app-silent-emit', { exitCode: 0, silent: true });

    assert.ok(silentConnection.frames.length > 0, 'silent run still streams its events');
    for (const frame of silentConnection.frames) {
      assert.equal(frame.silent, true, `frame kind=${frame.kind} must carry silent:true`);
    }
  });
});

test('normal run does not tag streamed events with silent:true', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-normal-emit', 'claude', '/workspace/demo');
    const connection = new FakeConnection();
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-normal-emit',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
    });
    assert.ok(run);

    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'native', content: 'part' });
    chatRunRegistry.completeRun('app-normal-emit', { exitCode: 0 });

    assert.ok(connection.frames.length > 0);
    for (const frame of connection.frames) {
      // `silent` must be absent (or falsy) so the existing UI path renders
      // normally — the tag is reserved for silent runs only.
      assert.notEqual(frame.silent, true, 'normal-run frames must not be flagged silent');
    }
  });
});

test('completeRun with silent:true targets the silent slot safety net', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-silent-3', 'claude', '/workspace/demo');
    const connection = new FakeConnection();

    const silentRun = chatRunRegistry.startRun({
      appSessionId: 'app-silent-3',
      provider: 'claude',
      providerSessionId: null,
      connection,
      userId: null,
      silent: true,
    });
    assert.ok(silentRun);

    // The handleChatSend `finally` safety net must address the silent slot;
    // a plain completeRun(appSessionId) would miss it and leave the silent
    // run stuck "running".
    chatRunRegistry.completeRun('app-silent-3', { exitCode: 1, silent: true });

    const completes = connection.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 1, 'silent completeRun should emit the terminal complete frame');
  });
});
