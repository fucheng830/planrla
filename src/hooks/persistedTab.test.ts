import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkbenchPageStorageValue, isValidPersistedTab, parsePersistedTab } from './persistedTab';

test('workbench pages can be restored after reload', () => {
  assert.equal(isValidPersistedTab('overview'), true);
  assert.equal(isValidPersistedTab('inbox'), true);
  assert.equal(isValidPersistedTab('workflow'), true);
  assert.equal(isValidPersistedTab('schedule'), true);
});

test('legacy and invalid tabs still fall back safely', () => {
  assert.equal(isValidPersistedTab('chat'), true);
  assert.equal(isValidPersistedTab('files'), true);
  assert.equal(isValidPersistedTab('shell'), true);
  assert.equal(isValidPersistedTab('git'), true);
  assert.equal(isValidPersistedTab('browser'), false);
  assert.equal(isValidPersistedTab('unknown'), false);
  assert.equal(isValidPersistedTab('plugin:demo'), true);
});

test('persisted workbench page is stored under its own key', () => {
  assert.equal(getWorkbenchPageStorageValue('overview'), 'workbench:overview');
  assert.equal(getWorkbenchPageStorageValue('schedule'), 'workbench:schedule');
  assert.equal(getWorkbenchPageStorageValue('chat'), null);
});

test('persisted values round-trip through the namespaced format', () => {
  assert.equal(parsePersistedTab('workbench:overview'), 'overview');
  assert.equal(parsePersistedTab('workbench:schedule'), 'schedule');
  assert.equal(parsePersistedTab('chat'), 'chat');
  assert.equal(parsePersistedTab('overview'), 'overview');
  assert.equal(parsePersistedTab('browser'), null);
  assert.equal(parsePersistedTab(null), null);
});
