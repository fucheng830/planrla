import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTemplateStore } from '@/modules/kanban/template-store.js';
import type { TaskTemplate } from '@/modules/kanban/types.js';

function newStore() {
  const dir = join(tmpdir(), `kanban-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return createTemplateStore({ dir });
}

const NOW = '2026-01-01T00:00:00.000Z';

function makeTemplate(id: string, name: string, stageCount = 1): TaskTemplate {
  return {
    id, name, maxConcurrency: 2, createdAt: NOW, updatedAt: NOW,
    stages: Array.from({ length: stageCount }, (_, i) => ({
      id: `s${i}`, position: i,
      snapshot: {
        id: `ss${i}`, name: `Stage ${i}`,
        role: i === 0 ? 'user' : 'agent', autoAdvance: i === 0,
        createdAt: NOW, updatedAt: NOW,
      },
    })),
  };
}

test('saveTaskTemplate rejects empty name', () => {
  const store = newStore();
  assert.throws(() => store.saveTaskTemplate(makeTemplate('t1', '')), /name/i);
});

test('saveTaskTemplate rejects whitespace-only name', () => {
  const store = newStore();
  assert.throws(() => store.saveTaskTemplate(makeTemplate('t1', '   ')), /name/i);
});

test('saveTaskTemplate rejects template with no stages', () => {
  const store = newStore();
  assert.throws(() => store.saveTaskTemplate(makeTemplate('t1', 'T', 0)), /stage/i);
});

test('saveTaskTemplate normalizes maxConcurrency to 1 when <= 0', () => {
  const store = newStore();
  const t = makeTemplate('t1', 'T');
  t.maxConcurrency = 0;
  const saved = store.saveTaskTemplate(t);
  assert.equal(saved.maxConcurrency, 1);
});

test('saveTaskTemplate snapshots stages + defaults sessionReusePolicy to task_main', () => {
  const store = newStore();
  const saved = store.saveTaskTemplate(makeTemplate('t1', 'T'));
  assert.equal(saved.stages[0].snapshot.name, 'Stage 0');
  assert.equal(saved.stages[0].snapshot.sessionReusePolicy, 'task_main');
  assert.equal(saved.stages[0].position, 0);
});

test('getTaskTemplate returns saved template, null when missing', () => {
  const store = newStore();
  store.saveTaskTemplate(makeTemplate('t1', 'One'));
  const got = store.getTaskTemplate('t1');
  assert.ok(got);
  assert.equal(got!.name, 'One');
  assert.equal(store.getTaskTemplate('missing'), null);
});

test('listTaskTemplates returns all saved templates', () => {
  const store = newStore();
  store.saveTaskTemplate(makeTemplate('t1', 'One'));
  store.saveTaskTemplate(makeTemplate('t2', 'Two'));
  const all = store.listTaskTemplates();
  assert.equal(all.length, 2);
});

test('deleteTaskTemplate removes the template', () => {
  const store = newStore();
  store.saveTaskTemplate(makeTemplate('t1', 'T'));
  store.deleteTaskTemplate('t1');
  assert.equal(store.getTaskTemplate('t1'), null);
});
