import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '../../contexts/ThemeContext';
import { MessageHubPage } from './MessageHubPage';

function renderPage() {
  return renderToStaticMarkup(
    <ThemeProvider>
      <MessageHubPage />
    </ThemeProvider>,
  );
}

test('renders the collaboration hub information architecture', () => {
  const markup = renderPage();

  assert.match(markup, /消息协作中枢/);
  assert.match(markup, /频道/);
  assert.match(markup, /收件箱/);
  assert.match(markup, /消息详情/);
  assert.match(markup, /研发流程总览/);
});

test('exposes accessible theme, search, and reply controls', () => {
  const markup = renderPage();

  assert.match(markup, /aria-label="切换主题"/);
  assert.match(markup, /aria-label="搜索消息"/);
  assert.match(markup, /aria-label="回复消息"/);
  assert.match(markup, /role="tablist"/);
});
