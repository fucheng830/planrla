import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  __testing__,
} from './zcode-session-synchronizer.provider.js';

const { stripInjectedBlocks, isInjectedTitle } = __testing__!;

describe('zcode session title injection filtering', () => {
  it('strips a full system-reminder message to empty', () => {
    const text = '<system-reminder> As you answer the user\'s questions, you can use the following context: # agentsMd … </system-reminder>';
    assert.equal(stripInjectedBlocks(text), '');
  });

  it('keeps human text that follows an injected preamble', () => {
    const text = '<system-reminder>context…</system-reminder>\n\n帮我修复登录页面的样式';
    assert.equal(stripInjectedBlocks(text), '帮我修复登录页面的样式');
  });

  it('strips task-notification blocks with nested tags', () => {
    const text = '<task-notification>\n<task-id>exec-1</task-id>\n<summary>Background command failed</summary>\n</task-notification>';
    assert.equal(stripInjectedBlocks(text), '');
  });

  it('strips attribute-bearing open tags (in-app-browser-context)', () => {
    const text = '<in-app-browser-context source="ambient-ui-state">\nThe user has the in-app browser open.\n</in-app-browser-context>';
    assert.equal(stripInjectedBlocks(text), '');
  });

  it('drops fork-provenance marker lines', () => {
    const text = 'This session was forked from a previous session message.\nparentSessionId: sess_x';
    assert.equal(stripInjectedBlocks(text), '');
  });

  it('passes through ordinary prompts untouched', () => {
    assert.equal(stripInjectedBlocks('数据恢复了'), '数据恢复了');
  });

  it('flags stored titles derived from injected wrappers', () => {
    assert.equal(isInjectedTitle('<system-reminder> As you answer…'), true);
    assert.equal(isInjectedTitle('<task-notification>…'), true);
    assert.equal(isInjectedTitle('<in-app-browser-context source="x">…'), true);
    assert.equal(isInjectedTitle('数据恢复了'), false);
    assert.equal(isInjectedTitle('Untitled ZCode Session'), false);
    assert.equal(isInjectedTitle(undefined), true);
  });
});
