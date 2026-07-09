import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import {
  MAX_SESSION_TITLE_LENGTH,
  setSessionTitle,
} from '@/modules/mcp/session-rename.service.js';

type FakeFrame = { kind: string; [k: string]: unknown };
type FakeConnection = { readyState: number; frames: FakeFrame[]; send: (data: string) => void };

function makeFakeConnection(): FakeConnection {
  const frames: FakeFrame[] = [];
  return { readyState: 1, frames, send: (data) => frames.push(JSON.parse(data)) };
}

/**
 * Each scenario gets a fresh temp sqlite DB. The session row is seeded inside
 * the wrapper so the assert callback runs against a live connection — putting
 * `test()` at the top level (not nested inside the wrapper) avoids the
 * teardown-before-callback race that node:test's deferred scheduling would
 * otherwise cause.
 */
async function withIsolatedDb<T>(fn: () => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'planrla-rename-'));
  const prevDbPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  try {
    initializeDatabase();
    // createAppSession accepts an explicit app-facing session_id (provider
    // mapping stays NULL), which is exactly what renameSessionById keys on.
    sessionsDb.createAppSession('sess-rename-1', 'claude', '/test/rename-project');
    return await fn();
  } finally {
    closeConnection();
    process.env.DATABASE_PATH = prevDbPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test('setSessionTitle writes custom_name and broadcasts session_renamed', async () => {
  await withIsolatedDb(() => {
    connectedClients.clear();
    const conn = makeFakeConnection();
    connectedClients.add(conn as never);

    const result = setSessionTitle('sess-rename-1', '调试 WS 推送');

    assert.equal(result.title, '调试 WS 推送');
    assert.equal(sessionsDb.getSessionById('sess-rename-1')?.custom_name, '调试 WS 推送');
    assert.equal(conn.frames.length, 1);
    assert.equal(conn.frames[0].kind, 'session_renamed');
    assert.equal(conn.frames[0].sessionId, 'sess-rename-1');
    assert.equal(conn.frames[0].summary, '调试 WS 推送');

    connectedClients.clear();
  });
});

test('setSessionTitle trims surrounding whitespace before writing', async () => {
  await withIsolatedDb(() => {
    connectedClients.clear();
    setSessionTitle('sess-rename-1', '  padded title  ');
    assert.equal(sessionsDb.getSessionById('sess-rename-1')?.custom_name, 'padded title');
  });
});

test('setSessionTitle rejects empty title', () => {
  // No DB needed: the empty-title check throws before renameSessionById runs.
  assert.throws(() => setSessionTitle('sess-rename-1', '   '), /required/i);
});

test('setSessionTitle rejects title longer than MAX_SESSION_TITLE_LENGTH', () => {
  const tooLong = 'a'.repeat(MAX_SESSION_TITLE_LENGTH + 1);
  assert.throws(() => setSessionTitle('sess-rename-1', tooLong), /exceed/i);
});
