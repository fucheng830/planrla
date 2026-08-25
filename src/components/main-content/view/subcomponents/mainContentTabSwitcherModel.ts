import type { AppTab } from '../../../../types/app';

export type WorkbenchPageTab = Extract<AppTab, 'overview' | 'inbox' | 'workflow' | 'schedule'>;

export function isWorkbenchPageTab(tab: string): tab is WorkbenchPageTab {
  return tab === 'overview' || tab === 'inbox' || tab === 'workflow' || tab === 'schedule';
}

export function getWorkbenchPageTarget(requestedTab: string): AppTab | null {
  if (!isWorkbenchPageTab(requestedTab)) return null;
  // Workbench pages are stable destinations. Clicking the already-active page
  // keeps it selected instead of behaving as a hidden return-to-chat toggle.
  return requestedTab;
}
