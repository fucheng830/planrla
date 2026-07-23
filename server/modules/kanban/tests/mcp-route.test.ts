import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createKanbanMcpRouter } from '@/modules/kanban/mcp.route.js';
import type { Task } from '@/modules/kanban/types.js';

function fakeKanban(overrides: { task?: Task | null; nextCalls?: string[]; prevCalls?: string[]; throwOnNext?: boolean; nextTask?: Task | null; events?: any[] } = {}) {
  const task: Task = overrides.task ?? {
    id: 't1', taskNumber: 1, rootId: 'r1', taskTemplateId: 'tpl', createWorktree: true,
    currentStageIndex: 0, status: 'running', schedulerAdmitted: true, labels: [],
    auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
    createdAt: '', updatedAt: '',
  } as any;
  const nextCalls = overrides.nextCalls ?? [];
  const prevCalls = overrides.prevCalls ?? [];
  const events = overrides.events ?? [];
  const taskStore = {
    getTask: (id: string) => (id === task.id ? { ...task } : null),
    insertTaskEvent: (e: any) => { events.push(e); },
  };
  const service = {
    next: (_rootId: string, id: string) => {
      if (overrides.throwOnNext) throw new Error('cannot advance: terminal guard');
      nextCalls.push(id); return { ...task, currentStageIndex: task.currentStageIndex + 1 };
    },
    prev: (_rootId: string, id: string) => { prevCalls.push(id); return { ...task }; },
    getNextTask: () => overrides.nextTask ?? null,
  };
  return {
    getKanban: () => ({ service: service as any, taskStore: taskStore as any, scheduler: { schedule: () => {} } }),
    nextCalls, prevCalls, events,
  };
}

function appFor(kanban: ReturnType<typeof fakeKanban>) {
  const app = express();
  app.use(express.json());
  app.locals.wss = null;
  app.use('/api/mcp/kanban', createKanbanMcpRouter(kanban));
  return app;
}

test('initialize returns protocol version + server info', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.protocolVersion, '2024-11-05');
  assert.equal(res.body.result.serverInfo.name, 'planrla-kanban');
});

test('tools/list advertises task_next, task_prev, task_status', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = res.body.result.tools.map((t: any) => t.name);
  assert.deepEqual(names.sort(), ['task_complete', 'task_next', 'task_next_up', 'task_prev', 'task_status']);
});

test('tools/call task_next advances via service.next(rootId, taskId)', async () => {
  const kanban = fakeKanban({ nextCalls: [] });
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'task_next', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.equal(kanban.nextCalls[0], 't1');
  assert.match(JSON.stringify(res.body.result), /running/);
});

test('tools/call task_prev calls service.prev', async () => {
  const kanban = fakeKanban({ prevCalls: [] });
  const app = appFor(kanban);
  await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'task_prev', arguments: { taskId: 't1' } },
  });
  assert.equal(kanban.prevCalls[0], 't1');
});

test('tools/call task_status returns task snapshot without mutating', async () => {
  const kanban = fakeKanban();
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { name: 'task_status', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.equal(kanban.nextCalls.length, 0);
  // The MCP tool returns a text content envelope; parse the inner JSON to
  // assert the task snapshot fields rather than fighting JSON-string escaping
  // when matching against the outer stringified response.
  assert.equal(res.body.result.content[0].type, 'text');
  const snapshot = JSON.parse(res.body.result.content[0].text);
  assert.equal(snapshot.status, 'running');
  assert.equal(snapshot.taskId, 't1');
  assert.equal(snapshot.stageIndex, 0);
});

test('tools/call with unknown taskId returns JSON-RPC error', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 6, method: 'tools/call',
    params: { name: 'task_status', arguments: { taskId: 'nope' } },
  });
  assert.ok(res.body.error);
  assert.equal(res.body.error.code, -32602);
});

test('tools/call missing taskId returns JSON-RPC error -32602', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'task_next', arguments: {} },
  });
  assert.equal(res.body.error.code, -32602);
});

test('unknown tool name returns JSON-RPC error -32601', async () => {
  const app = appFor(fakeKanban());
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'bogus', arguments: { taskId: 't1' } },
  });
  assert.equal(res.body.error.code, -32601);
});

test('tools/call returns -32603 internal error when service throws', async () => {
  // Simulates service.next throwing (e.g. terminal-task guard / cannot-prev on
  // first stage). The route's top-level try/catch must map any throw to the
  // JSON-RPC -32603 internal-error code, surfacing the message, HTTP 200.
  const app = appFor(fakeKanban({ throwOnNext: true }));
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'task_next', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.error, 'expected a JSON-RPC error');
  assert.equal(res.body.error.code, -32603);
  assert.match(res.body.error.message, /terminal guard/);
});

test('kanban MCP rejects non-loopback requests (403, loopback guard)', async () => {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', true); // make req.ip honor X-Forwarded-For
  app.locals.wss = null;
  app.use('/api/mcp/kanban', createKanbanMcpRouter(fakeKanban()));
  const res = await request(app).post('/api/mcp/kanban')
    .set('X-Forwarded-For', '192.168.1.50')
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(res.status, 403);
  assert.match(JSON.stringify(res.body), /loopback-only/);
});


test('tools/call task_next_up returns the service.getNextTask recommendation', async () => {
  const nextTask = {
    id: 't2', taskNumber: 2, rootId: 'r1', taskTemplateId: 'tpl', taskTemplateName: 'T-tpl',
    createWorktree: true, currentStageIndex: 0, status: 'queued', schedulerAdmitted: false,
    labels: [], priority: 'high', dependencies: [],
    auxFlags: { askUserWaiting: false, hasPlan: false, hasTodos: false, hasTask: false },
    createdAt: '', updatedAt: '',
  } as any;
  const app = appFor(fakeKanban({ nextTask }));
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'task_next_up', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.nextTask.taskId, 't2');
  assert.equal(payload.nextTask.taskNumber, 2);
  assert.equal(payload.nextTask.priority, 'high');
});

test('tools/call task_next_up returns null when nothing is runnable', async () => {
  const app = appFor(fakeKanban({ nextTask: null }));
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 10, method: 'tools/call',
    params: { name: 'task_next_up', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body.result.content[0].text);
  assert.equal(payload.nextTask, null);
});

test('tools/call task_complete records goal_completed event + advances via service.next(rootId, taskId)', async () => {
  const kanban = fakeKanban({ nextCalls: [], events: [] });
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 11, method: 'tools/call',
    params: { name: 'task_complete', arguments: { taskId: 't1', summary: 'done' } },
  });
  assert.equal(res.status, 200);
  // service.next must be invoked to advance the stage.
  assert.equal(kanban.nextCalls[0], 't1');
  // A goal_completed event must be recorded with the summary payload.
  const goalEvents = kanban.events.filter((e: any) => e.type === 'goal_completed');
  assert.equal(goalEvents.length, 1);
  assert.equal(goalEvents[0].taskId, 't1');
  assert.equal(goalEvents[0].stageRunId, undefined);
  assert.deepEqual(JSON.parse(goalEvents[0].payloadJson), { summary: 'done' });
});

test('tools/call task_complete without summary records goal_completed with no payload', async () => {
  // summary is optional — the event should still be recorded so the timeline
  // shows the declaration even if the agent omits it.
  const kanban = fakeKanban({ nextCalls: [], events: [] });
  const app = appFor(kanban);
  const res = await request(app).post('/api/mcp/kanban').send({
    jsonrpc: '2.0', id: 12, method: 'tools/call',
    params: { name: 'task_complete', arguments: { taskId: 't1' } },
  });
  assert.equal(res.status, 200);
  assert.equal(kanban.nextCalls[0], 't1');
  const goalEvents = kanban.events.filter((e: any) => e.type === 'goal_completed');
  assert.equal(goalEvents.length, 1);
  assert.equal(goalEvents[0].payloadJson, undefined);
});
