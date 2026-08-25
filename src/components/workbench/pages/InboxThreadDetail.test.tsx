import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InboxThreadDetail } from './InboxThreadDetail';
import type { InboxThread } from './inboxModel';

const thread: InboxThread = {
  id: 'ai-confirm',
  title: '请求确认：技术方案边界',
  sender: 'Planrla Agent',
  source: 'AI 协作',
  channel: 'ai',
  preview: '需要确认是否允许在线 DDL。',
  time: '2 分钟前',
  unread: true,
  starred: true,
  state: 'waiting',
  stateLabel: '等待确认',
};

test('thread detail exposes AI decisions and workflow bindings', () => {
  const markup = renderToStaticMarkup(
    <InboxThreadDetail
      thread={thread}
      projectName="planrla"
      onBack={() => undefined}
    />,
  );

  assert.match(markup, /aria-label="线程详情"/);
  assert.match(markup, /AI 协作请求/);
  assert.match(markup, /aria-label="批准并继续执行"/);
  assert.match(markup, /aria-label="驳回协作请求"/);
  assert.match(markup, /aria-label="转交给负责人"/);
  assert.match(markup, /aria-label="消息上下文"/);
  assert.match(markup, /绑定项目/);
  assert.match(markup, /绑定任务/);
  assert.match(markup, /关联会话/);
  assert.match(markup, /需求设计/);
  assert.match(markup, /技术方案/);
  assert.match(markup, /测试验证/);
  assert.match(markup, /交付/);
});
