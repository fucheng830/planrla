import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { KimiSessionSynchronizer } from '@/modules/providers/list/kimi/kimi-session-synchronizer.provider.js';
import { KimiSessionsProvider } from '@/modules/providers/list/kimi/kimi-sessions.provider.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'kimi-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function withKimiHome(runTest: (kimiHome: string) => void | Promise<void>): Promise<void> {
  const previousKimiHome = process.env.KIMI_CODE_HOME;
  const kimiHome = await mkdtemp(path.join(os.tmpdir(), 'kimi-home-'));
  process.env.KIMI_CODE_HOME = kimiHome;

  try {
    await runTest(kimiHome);
  } finally {
    if (previousKimiHome === undefined) {
      delete process.env.KIMI_CODE_HOME;
    } else {
      process.env.KIMI_CODE_HOME = previousKimiHome;
    }
    await rm(kimiHome, { recursive: true, force: true });
  }
}

const WORKSPACE = path.join(os.tmpdir(), 'kimi-workspace');

const WIRE_EVENTS = [
  JSON.stringify({ type: 'metadata', protocol_version: '1.4', created_at: 1784290821800 }),
  JSON.stringify({
    type: 'turn.prompt',
    input: [{ type: 'text', text: '帮我看一下这个项目' }],
    origin: { kind: 'user' },
    time: 1784290822000,
  }),
  // User echoes, injections, and background notifications must not leak into history.
  JSON.stringify({
    type: 'context.append_message',
    message: { role: 'user', content: [{ type: 'text', text: '帮我看一下这个项目' }], origin: { kind: 'user' } },
    time: 1784290822000,
  }),
  JSON.stringify({
    type: 'context.append_message',
    message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>note</system-reminder>' }], origin: { kind: 'injection' } },
    time: 1784290822001,
  }),
  JSON.stringify({
    type: 'context.append_loop_event',
    event: {
      type: 'content.part',
      uuid: 'part-think-1',
      part: { type: 'think', think: '让我先搜索一下代码库。' },
    },
    time: 1784290823000,
  }),
  JSON.stringify({
    type: 'context.append_loop_event',
    event: {
      type: 'tool.call',
      uuid: 'tool_call_1',
      toolCallId: 'tool_call_1',
      name: 'Grep',
      args: { pattern: 'kimi' },
    },
    time: 1784290824000,
  }),
  JSON.stringify({
    type: 'context.append_loop_event',
    event: {
      type: 'tool.result',
      toolCallId: 'tool_call_1',
      result: { output: 'src/kimi.ts' },
    },
    time: 1784290825000,
  }),
  JSON.stringify({
    type: 'context.append_loop_event',
    event: {
      type: 'content.part',
      uuid: 'part-text-1',
      part: { type: 'text', text: '找到了一个匹配文件。' },
    },
    time: 1784290826000,
  }),
  JSON.stringify({
    type: 'usage.record',
    model: 'kimi-code/k3',
    usage: { inputOther: 100, output: 20, inputCacheRead: 40, inputCacheCreation: 0 },
    usageScope: 'turn',
    time: 1784290827000,
  }),
].join('\n');

async function createKimiSessionFixture(
  kimiHome: string,
  options: { sessionId?: string; title?: string; workDir?: string } = {},
): Promise<{ sessionId: string; sessionDir: string; workDir: string }> {
  const sessionId = options.sessionId ?? 'session_test-1';
  const workDir = options.workDir ?? WORKSPACE;
  const sessionDir = path.join(kimiHome, 'sessions', 'wd_workspace_abc123', sessionId);

  await mkdir(path.join(sessionDir, 'agents', 'main'), { recursive: true });
  await writeFile(
    path.join(sessionDir, 'state.json'),
    JSON.stringify({
      createdAt: '2026-07-17T12:00:00.000Z',
      updatedAt: '2026-07-17T12:30:00.000Z',
      title: options.title ?? '帮我看一下这个项目',
      isCustomTitle: false,
      agents: { main: { type: 'main' } },
    }),
  );
  await writeFile(path.join(sessionDir, 'agents', 'main', 'wire.jsonl'), WIRE_EVENTS);
  await appendSessionIndex(kimiHome, { sessionId, sessionDir, workDir });

  return { sessionId, sessionDir, workDir };
}

async function appendSessionIndex(
  kimiHome: string,
  entry: { sessionId: string; sessionDir: string; workDir: string },
): Promise<void> {
  const indexPath = path.join(kimiHome, 'session_index.jsonl');
  const line = JSON.stringify({
    sessionId: entry.sessionId,
    sessionDir: entry.sessionDir.replace(/\\/g, '/'),
    workDir: entry.workDir.replace(/\\/g, '/'),
  });
  const { readFile } = await import('node:fs/promises');
  let existing = '';
  try {
    existing = await readFile(indexPath, 'utf8');
  } catch {
    // First entry.
  }
  await writeFile(indexPath, existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`);
}

test('kimi synchronizer indexes sessions from the global session index', async () => {
  await withIsolatedDatabase(async () => {
    await withKimiHome(async (kimiHome) => {
      const fixture = await createKimiSessionFixture(kimiHome);
      const synchronizer = new KimiSessionSynchronizer();

      const processed = await synchronizer.synchronize();
      assert.equal(processed, 1);

      const indexed = sessionsDb.getSessionById(fixture.sessionId);
      assert.ok(indexed);
      assert.equal(indexed?.provider, 'kimi');
      assert.equal(indexed?.custom_name, '帮我看一下这个项目');
      assert.equal(indexed?.project_path, fixture.workDir);
      assert.ok(indexed?.jsonl_path?.endsWith('wire.jsonl'));
    });
  });
});

test('kimi synchronizer skips pruned sessions missing from disk', async () => {
  await withIsolatedDatabase(async () => {
    await withKimiHome(async (kimiHome) => {
      await appendSessionIndex(kimiHome, {
        sessionId: 'session_gone',
        sessionDir: path.join(kimiHome, 'sessions', 'wd_x', 'session_gone'),
        workDir: WORKSPACE,
      });

      const synchronizer = new KimiSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(), 0);
    });
  });
});

test('kimi synchronizeFile indexes one session from state.json changes', async () => {
  await withIsolatedDatabase(async () => {
    await withKimiHome(async (kimiHome) => {
      const fixture = await createKimiSessionFixture(kimiHome, { sessionId: 'session_file-1' });
      const synchronizer = new KimiSessionSynchronizer();

      assert.equal(await synchronizer.synchronizeFile(path.join(fixture.sessionDir, 'logs', 'kimi-code.log')), null);

      const indexedId = await synchronizer.synchronizeFile(path.join(fixture.sessionDir, 'state.json'));
      assert.equal(indexedId, fixture.sessionId);
      assert.ok(sessionsDb.getSessionById(fixture.sessionId));
    });
  });
});

test('kimi fetchHistory normalizes wire.jsonl events and merges tool results', async () => {
  await withIsolatedDatabase(async () => {
    await withKimiHome(async (kimiHome) => {
      const fixture = await createKimiSessionFixture(kimiHome);
      await new KimiSessionSynchronizer().synchronize();

      const provider = new KimiSessionsProvider();
      const history = await provider.fetchHistory(fixture.sessionId);

      const kinds = history.messages.map((message) => `${message.kind}${message.role ? `:${message.role}` : ''}`);
      assert.deepEqual(kinds, [
        'text:user',
        'thinking',
        'tool_use',
        'tool_result',
        'text:assistant',
      ]);

      const userMessage = history.messages[0];
      assert.equal(userMessage?.content, '帮我看一下这个项目');

      const toolUse = history.messages.find((message) => message.kind === 'tool_use');
      assert.equal(toolUse?.toolName, 'Grep');
      assert.deepEqual(toolUse?.toolInput, { pattern: 'kimi' });
      assert.equal(toolUse?.toolResult?.content, 'src/kimi.ts');
      assert.equal(toolUse?.toolResult?.isError, false);

      const tokenUsage = history.tokenUsage as
        { used?: number; inputTokens?: number; outputTokens?: number } | undefined;
      assert.equal(tokenUsage?.used, 160);
      assert.equal(tokenUsage?.inputTokens, 140);
      assert.equal(tokenUsage?.outputTokens, 20);
    });
  });
});

test('kimi normalizeMessage handles live stream-json events', () => {
  const provider = new KimiSessionsProvider();

  const text = provider.normalizeMessage({ role: 'assistant', content: '你好' }, 'session_live');
  assert.equal(text.length, 1);
  assert.equal(text[0]?.kind, 'stream_delta');
  assert.equal(text[0]?.content, '你好');
  assert.equal(text[0]?.provider, 'kimi');

  const toolCalls = provider.normalizeMessage({
    role: 'assistant',
    tool_calls: [{
      type: 'function',
      id: 'tool_abc',
      function: { name: 'Bash', arguments: '{"command":"echo hi"}' },
    }],
  }, 'session_live');
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.kind, 'tool_use');
  assert.equal(toolCalls[0]?.toolName, 'Bash');
  assert.deepEqual(toolCalls[0]?.toolInput, { command: 'echo hi' });
  assert.equal(toolCalls[0]?.toolId, 'tool_abc');

  const toolResult = provider.normalizeMessage({
    role: 'tool',
    tool_call_id: 'tool_abc',
    content: 'hi\n',
  }, 'session_live');
  assert.equal(toolResult.length, 1);
  assert.equal(toolResult[0]?.kind, 'tool_result');
  assert.equal(toolResult[0]?.toolId, 'tool_abc');
  assert.equal(toolResult[0]?.content, 'hi\n');

  const meta = provider.normalizeMessage({
    role: 'meta',
    type: 'session.resume_hint',
    session_id: 'session_xyz',
  }, 'session_live');
  assert.equal(meta.length, 0);

  assert.equal(provider.normalizeMessage('not an object', 'session_live').length, 0);
});
