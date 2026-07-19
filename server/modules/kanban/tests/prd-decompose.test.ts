import assert from 'node:assert/strict';
import test from 'node:test';

import { decomposePrd } from '@/modules/kanban/prd-decompose.js';

type SpawnFn = (command: string, options: Record<string, unknown>, writer: any) => Promise<unknown>;

const streamingSpawn = (chunks: string[], asString = false): SpawnFn =>
  async (_command, _options, writer) => {
    for (const chunk of chunks) {
      const msg = { kind: 'stream_delta', content: chunk };
      writer.send(asString ? JSON.stringify(msg) : msg);
    }
  };

test('decomposePrd parses a valid JSON array and normalizes fields', async () => {
  const items = await decomposePrd({
    prd: 'Build a login page',
    provider: 'claude',
    spawnFn: streamingSpawn([
      'Here is the plan:\n[{"title":"API","input":"Build the auth API","priority":"high","dependsOn":[]},',
      '{"title":"UI","input":"Build the login form","priority":"bogus","dependsOn":[0,7]}]',
    ]),
  });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, 'API');
  assert.equal(items[0]?.priority, 'high');
  assert.deepEqual(items[0]?.dependsOn, []);
  // Invalid priority falls back to medium; future/self indices are dropped.
  assert.equal(items[1]?.priority, 'medium');
  assert.deepEqual(items[1]?.dependsOn, [0]);
});

test('decomposePrd accepts JSON-string writer messages', async () => {
  const items = await decomposePrd({
    prd: 'x',
    provider: 'claude',
    spawnFn: streamingSpawn(['[{"title":"T","input":"do it","priority":"low","dependsOn":[]}]'], true),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.priority, 'low');
});

test('decomposePrd rejects output without a JSON array', async () => {
  await assert.rejects(
    decomposePrd({ prd: 'x', provider: 'claude', spawnFn: streamingSpawn(['no json here']) }),
    /no JSON array/,
  );
});

test('decomposePrd rejects an empty task list', async () => {
  await assert.rejects(
    decomposePrd({ prd: 'x', provider: 'claude', spawnFn: streamingSpawn(['[]']) }),
    /empty task list/,
  );
});

test('decomposePrd rejects an empty prd before calling the provider', async () => {
  let called = false;
  await assert.rejects(
    decomposePrd({
      prd: '   ',
      provider: 'claude',
      spawnFn: async () => { called = true; },
    }),
    /prd is required/,
  );
  assert.equal(called, false);
});

test('decomposePrd surfaces unknown providers', async () => {
  await assert.rejects(
    decomposePrd({ prd: 'x', provider: 'not-a-provider' }),
    /unknown provider/,
  );
});
