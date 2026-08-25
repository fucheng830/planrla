import type { TFunction } from 'i18next';
import { Archive, CalendarDays, Folder, FolderTree, Inbox, KanbanSquare, LayoutDashboard, MessageSquare, Workflow } from 'lucide-react';

import type { WorkbenchRailItem } from '../../../workbench';
import type { AppTab } from '../../../../types/app';

export function isWorkbenchTab(activeTab: AppTab | undefined): boolean {
  return activeTab === 'overview' || activeTab === 'inbox' || activeTab === 'workflow' || activeTab === 'schedule' || activeTab === 'kanban';
}

export function getSidebarRailItems(t: TFunction, completedSessionsCount: number): readonly WorkbenchRailItem[] {
  return [
    { id: 'projects', label: t('search.modeProjects'), icon: Folder },
    { id: 'sessions', label: t('search.modeSessions'), icon: MessageSquare, badge: completedSessionsCount > 0 ? 'completed' : undefined },
    { id: 'archived', label: t('search.archiveOnlyTooltip', 'Archive only'), icon: Archive },
    { id: 'files', label: t('files.title', 'Files'), icon: FolderTree },
    { id: 'overview', label: t('common:tabs.overview', 'Overview'), icon: LayoutDashboard },
    { id: 'inbox', label: t('common:tabs.inbox', 'Inbox'), icon: Inbox },
    { id: 'workflow', label: t('common:tabs.workflow', 'Workflow'), icon: Workflow },
    { id: 'kanban', label: t('common:tabs.kanban', 'Kanban'), icon: KanbanSquare },
    { id: 'schedule', label: t('common:tabs.schedule', 'Calendar'), icon: CalendarDays },
  ];
}
