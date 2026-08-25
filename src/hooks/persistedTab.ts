export const PERSISTED_TABS: ReadonlySet<string> = new Set([
  'chat',
  'files',
  'shell',
  'git',
  'overview',
  'inbox',
  'workflow',
  'schedule',
]);

export function isValidPersistedTab(tab: string): boolean {
  return PERSISTED_TABS.has(tab) || tab.startsWith('plugin:');
}

export function getWorkbenchPageStorageValue(tab: string): `workbench:${string}` | null {
  return tab === 'overview' || tab === 'inbox' || tab === 'workflow' || tab === 'schedule'
    ? (`workbench:${tab}` as const)
    : null;
}

export function parsePersistedTab(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith('workbench:')) {
    const page = stored.slice('workbench:'.length);
    return page === 'overview' || page === 'inbox' || page === 'workflow' || page === 'schedule'
      ? page
      : null;
  }
  return isValidPersistedTab(stored) ? stored : null;
}
