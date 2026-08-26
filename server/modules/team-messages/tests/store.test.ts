/** Store-level coverage for team/customer messages: kind persistence, filter,
 *  thread grouping fields. In-memory DB seeded straight from the schema SQL so
 *  column drift fails loudly here too. */
import test from 'node:test';
import assert from 'node:assert';

import Database from 'better-sqlite3';

import { TEAM_MESSAGES_TABLE_SCHEMA_SQL } from '@/modules/database/index.js';

import { createTeamMessageStore } from '../store.js';
function setupStore() {
  const db = new Database(':memory:');
  db.exec(TEAM_MESSAGES_TABLE_SCHEMA_SQL);
  return createTeamMessageStore({ db });
}

test('team and customer messages persist with kind/channel/thread', () => {
  const store = setupStore();
  const team = store.createMessage({ rootId: 'r1', sender: 'fucheng', content: '今晚合并 main' });
  assert.equal(team.kind, 'team');

  const customer = store.createMessage({
    rootId: 'r1',
    kind: 'customer',
    channel: '企业微信',
    sender: '王先生',
    content: 'Windows 打包问题什么时候修好?',
  });
  assert.equal(customer.kind, 'customer');
  assert.equal(customer.channel, '企业微信');

  const reply = store.createMessage({
    rootId: 'r1',
    kind: 'customer',
    threadId: customer.id,
    sender: 'fucheng',
    content: '本周内交付',
  });

  const all = store.listMessages('r1');
  assert.equal(all.length, 3);

  const onlyCustomers = store.listMessages('r1', 100, 'customer');
  assert.equal(onlyCustomers.length, 2);
  // Latest first (DESC order).
  assert.equal(onlyCustomers[0].id, reply.id);
});

test('kind filter does not leak across roots and delete stays root-scoped', () => {
  const store = setupStore();
  store.createMessage({ rootId: 'r1', kind: 'customer', sender: '李女士', channel: '电话', content: '咨询报价' });
  assert.equal(store.listMessages('r2').length, 0);
  const msg = store.listMessages('r1')[0];
  store.deleteMessage(msg.id, 'other-root');
  assert.equal(store.listMessages('r1').length, 1, 'wrong-root delete is a no-op');
});
