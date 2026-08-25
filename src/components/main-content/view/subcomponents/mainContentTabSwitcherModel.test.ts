import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkbenchPageTarget, isWorkbenchPageTab } from './mainContentTabSwitcherModel';

test('active workbench page remains selected when clicked again', () => {
  assert.equal(getWorkbenchPageTarget('overview'), 'overview');
  assert.equal(getWorkbenchPageTarget('inbox'), 'inbox');
  assert.equal(getWorkbenchPageTarget('workflow'), 'workflow');
  assert.equal(getWorkbenchPageTarget('schedule'), 'schedule');
});

test('extension and plugin targets are not treated as workbench pages', () => {
  assert.equal(isWorkbenchPageTab('kanban'), false);
  assert.equal(isWorkbenchPageTab('cron'), false);
  assert.equal(isWorkbenchPageTab('chat'), false);
  assert.equal(isWorkbenchPageTab('plugin:demo'), false);
  assert.equal(getWorkbenchPageTarget('kanban'), null);
});
