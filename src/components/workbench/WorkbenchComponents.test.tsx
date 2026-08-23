import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bot, FolderKanban } from 'lucide-react';

import { WorkbenchRail, WorkbenchSection, WorkbenchStatus } from './index';

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
