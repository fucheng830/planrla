import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bot, FolderKanban } from 'lucide-react';

import { getSidebarRailItems, isWorkbenchTab } from '../sidebar/view/subcomponents/sidebarRailItems';

import { SchedulePage } from './pages/SchedulePage';
import { WORKFLOW_AGENT_ROWS, WORKFLOW_STAGES } from './pages/workflowModel';

import {
  WorkbenchEmptyState,
  WorkbenchHeader,
  WorkbenchInspector,
  WorkbenchRail,
  WorkbenchSection,
  WorkbenchStatus,
} from './index';

test('WorkbenchRail exposes labeled navigation controls and active state', () => {
  const markup = renderToStaticMarkup(
    <WorkbenchRail
      items={[{ id: 'workspace', label: 'Workspace', icon: FolderKanban }]}
      activeId="workspace"
      onSelect={() => undefined}
    />,
  );

  assert.match(markup, /aria-label="Workspace"/);
  assert.match(markup, /data-active="true"/);
});

test('sidebar rail includes workbench inbox and calendar entries', () => {
  const items = getSidebarRailItems(((key: string) => key) as never, 0);

  assert.deepEqual(
    items.map((item) => item.id),
    ['projects', 'sessions', 'archived', 'files', 'overview', 'inbox', 'workflow', 'schedule'],
  );
});

test('standalone workbench pages hide the project workspace panel', () => {
  assert.equal(isWorkbenchTab('overview'), true);
  assert.equal(isWorkbenchTab('inbox'), true);
  assert.equal(isWorkbenchTab('workflow'), true);
  assert.equal(isWorkbenchTab('schedule'), true);
  assert.equal(isWorkbenchTab('chat'), false);
  assert.equal(isWorkbenchTab(undefined), false);
});

test('workflow model includes the five delivery stages and agent status rail', () => {
  assert.deepEqual(WORKFLOW_STAGES, ['需求设计', '技术方案', '开工', '测试验证', '交付']);
  assert.deepEqual(WORKFLOW_AGENT_ROWS.map((agent) => agent.name), ['Codex', 'Claude', 'Gemini', 'Cursor']);
});

test('SchedulePage keeps calendar landmarks and both task forms in the workbench shell', () => {
  const markup = renderToStaticMarkup(
    <SchedulePage projectName="planrla" projectId="root-1" projectPath="C:/workspace/项目/planrla" />,
  );

  assert.match(markup, /日历与定时任务/);
  assert.match(markup, /calendar-workbench-grid/);
  assert.match(markup, /aria-label="新建任务面板"/);
  assert.match(markup, /新建定时任务/);
  assert.match(markup, /新建一次性任务/);
});

test('WorkbenchSection and WorkbenchStatus expose semantic state', () => {
  const markup = renderToStaticMarkup(
    <WorkbenchSection label="Current task">
      <WorkbenchStatus state="waiting" label="Needs review" />
    </WorkbenchSection>,
  );

  assert.match(markup, /aria-label="Current task"/);
  assert.match(markup, /data-state="waiting"/);
  assert.match(markup, /Needs review/);
});

test('Workbench components accept lucide icon components', () => {
  const markup = renderToStaticMarkup(
    <WorkbenchRail items={[{ id: 'agent', label: 'Agent', icon: Bot }]} activeId={null} onSelect={() => undefined} />,
  );

  assert.match(markup, /<svg/);
});

test('WorkbenchHeader and WorkbenchInspector expose shell landmarks', () => {
  const markup = renderToStaticMarkup(
    <WorkbenchHeader leading={<span>Planrla</span>} tabs={<span>Chat</span>} actions={<span>Actions</span>} />,
  ) + renderToStaticMarkup(
    <WorkbenchInspector title="Inspector" onClose={() => undefined}>
      <span>Preview</span>
    </WorkbenchInspector>,
  );

  assert.match(markup, /<header/);
  assert.match(markup, /aria-label="Inspector"/);
  assert.match(markup, /aria-label="Close Inspector"/);
});

test('WorkbenchEmptyState exposes one primary action', () => {
  const markup = renderToStaticMarkup(
    <WorkbenchEmptyState title="Choose a project" description="Start from a workspace." action={<button type="button">Open project</button>} />,
  );

  assert.match(markup, /Choose a project/);
  assert.match(markup, /Open project/);
});
