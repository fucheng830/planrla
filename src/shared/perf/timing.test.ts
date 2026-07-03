import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, measureAsync, __setDevMode } from './timing';

test('measure: 返回 fn 值（dev 模式）', () => {
  __setDevMode(true);
  assert.equal(measure('op', () => 42), 42);
});

test('measure: dev 模式调 console.debug', () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    measure('op', () => 1);
    assert.match(called, /^\[perf\] op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measure: 生产模式不调 console.debug', () => {
  __setDevMode(false);
  const original = console.debug;
  let called = false;
  console.debug = () => { called = true; };
  try {
    assert.equal(measure('op', () => 7), 7);
    assert.equal(called, false);
  } finally {
    console.debug = original;
  }
});

test('measure: 抛错时仍 console.debug（finally）', () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    assert.throws(() => measure('op', () => { throw new Error('boom'); }));
    assert.match(called, /^\[perf\] op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measureAsync: 返回 Promise 值 + dev console.debug', async () => {
  __setDevMode(true);
  const original = console.debug;
  let called = '';
  console.debug = (msg: string) => { called = msg; };
  try {
    const result = await measureAsync('async-op', async () => 'done');
    assert.equal(result, 'done');
    assert.match(called, /^\[perf\] async-op took \d+ms$/);
  } finally {
    console.debug = original;
  }
});

test('measureAsync: 生产模式不调 console.debug', async () => {
  __setDevMode(false);
  const original = console.debug;
  let called = false;
  console.debug = () => { called = true; };
  try {
    assert.equal(await measureAsync('async-op', async () => 'x'), 'x');
    assert.equal(called, false);
  } finally {
    console.debug = original;
  }
});
