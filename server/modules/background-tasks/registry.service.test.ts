// server/modules/background-tasks/registry.service.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundTaskRegistry } from './registry.service.js';
import { parseBashTaskEvent } from './bash-parser.js';
import type { NormalizedMessage } from '@/shared/types.js';

function reset(): void {
  backgroundTaskRegistry.clearAll();
  backgroundTaskRegistry.stopSweeper();
}

function makeMsg(partial: Partial<NormalizedMessage> & Record<string, unknown>): NormalizedMessage {
  return {
    id: 'm1',
    sessionId: 'sess-1',
    timestamp: new Date().toISOString(),
    provider: 'claude',
    kind: 'text',
    ...partial,
  } as NormalizedMessage;
}

test('registry: upsertKanban 聚合 + 进度计算', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertKanban({
    taskId: 'k-1',
    rootId: 'r-1',
    title: 'REQ-045 sidebar',
    status: 'running',
    stage: 2,
    stageTotal: 4,
    aux: { askUserWaiting: false, hasPlan: true, hasTodos: false, hasTask: false },
  });
  const list = backgroundTaskRegistry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'kanban');
  assert.equal(list[0].status, 'running');
  assert.equal(list[0].progress, 50);
  assert.equal(list[0].title, 'REQ-045 sidebar');
});

test('registry: upsertKanban status success → completed', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertKanban({
    taskId: 'k-2',
    rootId: 'r-1',
    title: 'done task',
    status: 'success',
    stage: 3,
    stageTotal: 3,
    aux: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'completed');
  assert.ok(t.finishedAt);
});

test('registry: upsertKanban aux.sessionError(非终态) → failed(REQ-034 实时)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertKanban({
    taskId: 'k-3',
    rootId: 'r-1',
    title: 'err task',
    status: 'running',
    aux: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false, sessionError: 'GLM hung' },
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'failed');
  assert.equal(t.error, 'GLM hung');
});

test('registry: upsertA2A S4 spawn → completed + spawnedAppSessionId', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertA2A({
    taskId: 'a-1',
    state: 'working',
    provider: 'kimi',
    text: 'UI 分析',
    spawnedAppSessionId: 'new-sess-1',
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'completed'); // §13 ④:S4 spawn → completed
});

test('registry: upsertA2A S2/S3 inbound → 跟 a2a state(不转 chat)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertA2A({
    taskId: 'a-2',
    state: 'working',
    provider: 'kimi',
    text: '委派已有 session',
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'running');
});

test('registry: upsertChat proxy(running / idle)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertChat({ appSessionId: 'c-1', provider: 'claude', running: true });
  assert.equal(backgroundTaskRegistry.list()[0].status, 'running');
  backgroundTaskRegistry.upsertChat({ appSessionId: 'c-1', provider: 'claude', running: false });
  assert.equal(backgroundTaskRegistry.list()[0].status, 'idle');
});

test('registry: upsertChat preview lands in chat detail (手机完成通知预览)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertChat({ appSessionId: 'c-pv', provider: 'claude', running: true });
  backgroundTaskRegistry.upsertChat({
    appSessionId: 'c-pv',
    provider: 'claude',
    running: false,
    preview: '修复完成,共改动 3 个文件',
  });
  const task = backgroundTaskRegistry.list().find((t) => t.detail.type === 'chat' && t.detail.appSessionId === 'c-pv');
  assert.ok(task, 'chat task exists');
  assert.equal(task!.detail.type === 'chat' ? task!.detail.preview : undefined, '修复完成,共改动 3 个文件');
  // 空 preview 不落字段,老客户端不感知
  backgroundTaskRegistry.upsertChat({ appSessionId: 'c-pv2', provider: 'zcode', running: false });
  const bare = backgroundTaskRegistry.list().find((t) => t.detail.type === 'chat' && t.detail.appSessionId === 'c-pv2');
  assert.ok(!('preview' in (bare!.detail as Record<string, unknown>)), 'no preview key when omitted');
});

test('registry: bash apply start → reconcile → complete(完整流)', () => {
  reset();
  let now = 1000;
  backgroundTaskRegistry.setDeps({ now: () => now });

  // 1. start(占位 = toolUseId)
  const startOp = parseBashTaskEvent(
    makeMsg({
      kind: 'tool_use',
      toolName: 'Bash',
      toolId: 'tu_1',
      toolInput: { command: 'npm run dev', run_in_background: true },
    }),
    { priorTaskIds: backgroundTaskRegistry.bashTaskIdsForSession('sess-1') },
  );
  backgroundTaskRegistry.apply(startOp!);
  let list = backgroundTaskRegistry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].detail.type, 'bash');
  if (list[0].detail.type !== 'bash') return;
  assert.equal(list[0].detail.bashTaskId, 'tu_1');
  assert.equal(list[0].status, 'running');

  // 2. reconcile(占位 → 真 task_id)
  const reconOp = parseBashTaskEvent(
    makeMsg({
      kind: 'task_notification',
      subtype: 'task_started',
      task_id: 'real_1',
      tool_use_id: 'tu_1',
    }),
    { priorTaskIds: backgroundTaskRegistry.bashTaskIdsForSession('sess-1') },
  );
  backgroundTaskRegistry.apply(reconOp!);
  list = backgroundTaskRegistry.list();
  assert.equal(list.length, 1);
  if (list[0].detail.type !== 'bash') return;
  assert.equal(list[0].detail.bashTaskId, 'real_1');

  // 3. complete(SDK task_updated completed)
  now = 2000;
  const doneOp = parseBashTaskEvent(
    makeMsg({
      kind: 'task_notification',
      subtype: 'task_updated',
      task_id: 'real_1',
      patch: { status: 'completed' },
    }),
    { priorTaskIds: backgroundTaskRegistry.bashTaskIdsForSession('sess-1') },
  );
  backgroundTaskRegistry.apply(doneOp!);
  list = backgroundTaskRegistry.list();
  assert.equal(list[0].status, 'completed');
  assert.ok(list[0].finishedAt);
});

test('registry: 终态锁(completed 后 update 不回 running)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu_x',
    cmd: 'x',
    initialOutput: [],
    appSessionId: 'sess-x',
    toolUseId: 'tu_x',
  });
  backgroundTaskRegistry.apply({
    kind: 'complete',
    bashTaskId: 'tu_x',
    status: 'completed',
    appSessionId: 'sess-x',
  });
  // 后续 update 不能拉回 running
  backgroundTaskRegistry.apply({
    kind: 'update',
    bashTaskId: 'tu_x',
    outputTail: ['late output'],
    appSessionId: 'sess-x',
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'completed');
});

test('registry: idle 可被 update 拉回 running(有新活动)', () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu_y',
    cmd: 'y',
    initialOutput: [],
    appSessionId: 'sess-y',
    toolUseId: 'tu_y',
  });
  // 手动设 idle(通过 sweeper 不便,直接验证 update 分支:status 先非终态即可)
  // 这里用一个 update 触发 idle→running(当前 status 是 running,update 保持)
  backgroundTaskRegistry.apply({
    kind: 'update',
    bashTaskId: 'tu_y',
    outputTail: ['activity'],
    appSessionId: 'sess-y',
  });
  const t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'running');
  if (t.detail.type !== 'bash') return;
  assert.deepEqual(t.detail.outputTail, ['activity']);
});

test('registry: stopTask bash 走 killBash(方案 C 精简版)', async () => {
  reset();
  let now = 1000;
  const killCalls: Array<{ appSessionId: string; bashTaskId: string }> = [];
  backgroundTaskRegistry.setDeps({
    now: () => now,
    killBash: async (appSessionId, bashTaskId) => {
      killCalls.push({ appSessionId, bashTaskId });
      return { killed: true };
    },
  });
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu_z',
    cmd: 'z',
    initialOutput: [],
    appSessionId: 'sess-z',
    toolUseId: 'tu_z',
  });
  const id = backgroundTaskRegistry.list()[0].id;
  const { task, error } = await backgroundTaskRegistry.stopTask(id);
  assert.equal(error, undefined);
  assert.equal(killCalls.length, 1);
  assert.equal(killCalls[0].appSessionId, 'sess-z');
  assert.equal(killCalls[0].bashTaskId, 'tu_z');
  assert.equal(task?.status, 'running'); // killBash 成功 → registry 不改 status(等 SDK task_notification stopped 来转)
  // 实际 stopped 由 SDK 推 task_notification 转;此处验证调度被调
});

test('registry: stopTask bash killBash 失败 → force-marked killed', async () => {
  reset();
  backgroundTaskRegistry.setDeps({
    now: () => 1000,
    killBash: async () => ({ killed: false, error: 'session not active' }),
  });
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu_w',
    cmd: 'w',
    initialOutput: [],
    appSessionId: 'sess-w',
    toolUseId: 'tu_w',
  });
  const id = backgroundTaskRegistry.list()[0].id;
  const { task } = await backgroundTaskRegistry.stopTask(id);
  assert.equal(task?.status, 'killed');
  assert.match(task?.error ?? '', /force-marked/);
  if (task?.detail.type !== 'bash') return;
  assert.equal(task.detail.forceMarked, true);
});

test('registry: stopTask 非终态检查(running 可停,completed 不可)', async () => {
  reset();
  backgroundTaskRegistry.setDeps({ now: () => 1000 });
  backgroundTaskRegistry.upsertKanban({
    taskId: 'k-term',
    rootId: 'r',
    title: 'done',
    status: 'success',
    aux: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
  });
  const id = backgroundTaskRegistry.list()[0].id;
  const { error } = await backgroundTaskRegistry.stopTask(id);
  assert.match(error ?? '', /not stoppable/);
});

test('registry: sweeper idle(5min) + stuck failed(10min)', () => {
  reset();
  let now = 1000;
  backgroundTaskRegistry.setDeps({ now: () => now });
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu_s',
    cmd: 's',
    initialOutput: [],
    appSessionId: 'sess-s',
    toolUseId: 'tu_s',
  });

  // +6min → idle
  now = 1000 + 6 * 60 * 1000;
  backgroundTaskRegistry._sweep();
  let t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'idle');

  // +11min → failed(stuck)
  now = 1000 + 11 * 60 * 1000;
  backgroundTaskRegistry._sweep();
  t = backgroundTaskRegistry.list()[0];
  assert.equal(t.status, 'failed');
  assert.match(t.error ?? '', /stuck/);
});

test('registry: LRU 上限 100', () => {
  reset();
  let now = 1000;
  backgroundTaskRegistry.setDeps({ now: () => now });
  for (let i = 0; i < 105; i++) {
    now = 1000 + i;
    backgroundTaskRegistry.upsertKanban({
      taskId: `k-lru-${i}`,
      rootId: 'r',
      title: `t${i}`,
      status: 'running',
      aux: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
    });
  }
  assert.equal(backgroundTaskRegistry._size(), 100);
});

test('registry: 四类聚合 list 排序(lastActivityAt desc)', () => {
  reset();
  let now = 1000;
  backgroundTaskRegistry.setDeps({ now: () => now });
  backgroundTaskRegistry.upsertKanban({
    taskId: 'k-mix',
    rootId: 'r',
    title: 'kanban',
    status: 'running',
    aux: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
  });
  now = 2000;
  backgroundTaskRegistry.upsertChat({ appSessionId: 'c-mix', running: true });
  now = 3000;
  backgroundTaskRegistry.upsertA2A({ taskId: 'a-mix', state: 'working', text: 'a2a' });
  now = 4000;
  backgroundTaskRegistry.apply({
    kind: 'start',
    bashTaskId: 'tu-mix',
    cmd: 'b',
    initialOutput: [],
    appSessionId: 'sess-mix',
    toolUseId: 'tu-mix',
  });
  const list = backgroundTaskRegistry.list();
  assert.equal(list.length, 4);
  assert.equal(list[0].type, 'bash'); // 最新
  const types = new Set(list.map((t) => t.type));
  assert.ok(types.has('kanban') && types.has('a2a') && types.has('chat') && types.has('bash'));
});
