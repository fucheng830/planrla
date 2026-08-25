import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SchedulePage } from './SchedulePage';
test('schedule page renders the real-data workbench shell', () => {
  const markup = renderToStaticMarkup(
    <SchedulePage projectName="planrla" projectId="root-1" projectPath="C:/workspace/项目/planrla" />,
  );

  assert.match(markup, /日历与定时任务/);
  assert.match(markup, /aria-label="新建任务面板"/);
  assert.match(markup, /新建定时任务/);
  assert.match(markup, /新建一次性任务/);
  assert.match(markup, /日程列表/);
  // Loading state shows until the schedule sources resolve.
  assert.match(markup, /正在加载定时任务与看板排程/);
});
