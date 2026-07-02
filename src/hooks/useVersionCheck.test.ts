import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRestartRequired } from './useVersionCheck';

test('computeRestartRequired: 打包模式永远 false(即使 version 不一致)', () => {
    assert.equal(computeRestartRequired(true, '0.3.0', '0.2.0'), false);
});

test('computeRestartRequired: 源码模式 + version 不一致 → true', () => {
    assert.equal(computeRestartRequired(false, '0.3.0', '0.2.0'), true);
});

test('computeRestartRequired: 源码模式 + version 一致 → false', () => {
    assert.equal(computeRestartRequired(false, '0.2.0', '0.2.0'), false);
});

test('computeRestartRequired: serverVersion 空/null → false(不误报)', () => {
    assert.equal(computeRestartRequired(false, '', '0.2.0'), false);
    assert.equal(computeRestartRequired(false, null as unknown as string, '0.2.0'), false);
});
