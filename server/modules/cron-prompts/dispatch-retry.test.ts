import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNextRunParts, kindForError } from './dispatch-retry.js';

test('kindForError classifies permanent vs transient failures', () => {
  assert.equal(kindForError('provider "foo" not supported'), 'permanent');
  assert.equal(kindForError('bound session "x" not found'), 'permanent');
  assert.equal(kindForError('bound session provider mismatch'), 'permanent');
  assert.equal(kindForError('project path does not exist: /tmp/gone'), 'transient');
  assert.equal(kindForError('session busy'), 'transient');
  assert.equal(kindForError('anything else'), 'transient');
});

test('formatNextRunParts formats backoff delays', () => {
  assert.deepEqual(formatNextRunParts(30_000), { minutes: 0, seconds: 30 });
  assert.deepEqual(formatNextRunParts(15 * 60_000), { minutes: 15, seconds: 0 });
});
