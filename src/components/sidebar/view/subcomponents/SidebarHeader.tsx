import { Archive, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose, Activity } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Button, Input, Tooltip } from '../../../../shared/view/ui';
import { IS_PLATFORM } from '../../../../constants/config';
import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  completedSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  // REQ-047 — 打开 Markdown 编辑器(可选)。无则不渲染入口按钮。
  onOpenMarkdownEditor?: () => void;
  // REQ-046 — 打开后台任务面板(可选)。无则不渲染入口按钮。
  onOpenBackgroundTasks?: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  completedSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  onOpenMarkdownEditor,
  onOpenBackgroundTasks,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  // 桌面端（非 macOS）的 Logo 已上移到自绘标题栏（chrome/TitleBar），这里避免重复。
  const hasCustomTitleBar =
    typeof window !== 'undefined' && !!window.electronAPI && window.electronAPI.platform !== 'darwin';
  const searchPlaceholder = searchMode === 'sessions'
    ? t('search.sessionsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : t('projects.searchPlaceholder');
  const completedBadgeText = completedSessionsCount > 99 ? '99+' : String(completedSessionsCount);

  const LogoBlock = () => (
    <img
      src="/logo.svg"
      alt="Planrla"
      title={t('app.title')}
      className="h-7 w-7 flex-shrink-0"
    />
  );

  const LogoLink = () =>
    IS_PLATFORM ? (
      <a
        href="https://planrla.com/dashboard"
        className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
        title={t('tooltips.viewEnvironments')}
      >
        <LogoBlock />
      </a>
    ) : (
      <LogoBlock />
    );

  // 桌面端头部按钮组（刷新已移到列表区右键菜单）
  const ActionButtons = () => (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      {onOpenBackgroundTasks && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
          onClick={onOpenBackgroundTasks}
          title="后台任务"
          aria-label="后台任务"
        >
          <Activity className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
        onClick={onCreateProject}
        title={t('tooltips.createProject')}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
        onClick={onCollapseSidebar}
        title={t('tooltips.hideSidebar')}
      >
        <PanelLeftClose className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div className="hidden px-3 pb-2 pt-3 md:block">
        {showSearchTools ? (
          <div className="space-y-2">
            {/* Row 1: compact search + action buttons */}
            <div className="flex items-center gap-1.5">
              {!hasCustomTitleBar && <LogoLink />}
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchFilter}
                  onChange={(event) => onSearchFilterChange(event.target.value)}
                  className="nav-search-input h-7 rounded-lg border-0 pl-8 pr-7 text-xs transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                {searchFilter && (
                  <button
                    onClick={onClearSearchFilter}
                    aria-label={t('tooltips.clearSearch')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              <ActionButtons />
            </div>
            {/* Row 2: search mode toggle */}
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              <button
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'projects'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Folder className="h-3 w-3" />
                {t('search.modeProjects')}
              </button>
              <button
                onClick={() => onSearchModeChange('sessions')}
                aria-pressed={searchMode === 'sessions'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'sessions'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative flex h-3 w-3 items-center justify-center">
                  <MessageSquare className="h-3 w-3" />
                  {completedSessionsCount > 0 && (
                    <span className="absolute -right-2.5 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-background">
                      {completedBadgeText}
                    </span>
                  )}
                </span>
                {t('search.modeSessions')}
              </button>
              <Tooltip content={t('search.archiveOnlyTooltip', 'Archive only')} position="top">
                <button
                  onClick={() => onSearchModeChange('archived')}
                  aria-pressed={searchMode === 'archived'}
                  aria-label={t('search.archiveOnlyTooltip', 'Archive only')}
                  title={t('search.archiveOnlyTooltip', 'Archive only')}
                  className={cn(
                    "flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                    searchMode === 'archived'
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Archive className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          </div>
        ) : (
          <div className={cn('flex items-center gap-2', hasCustomTitleBar ? 'justify-end' : 'justify-between')}>
            {!hasCustomTitleBar && <LogoLink />}
            <ActionButtons />
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://planrla.com/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
              onClick={onCreateProject}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile search */}
        {showSearchTools && (
          <div className="mt-2.5 space-y-2">
            <div className="flex rounded-lg bg-muted/50 p-0.5">
              <button
                onClick={() => onSearchModeChange('projects')}
                aria-pressed={searchMode === 'projects'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'projects'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Folder className="h-3 w-3" />
                {t('search.modeProjects')}
              </button>
              <button
                onClick={() => onSearchModeChange('sessions')}
                aria-pressed={searchMode === 'sessions'}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  searchMode === 'sessions'
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="relative flex h-3 w-3 items-center justify-center">
                  <MessageSquare className="h-3 w-3" />
                  {completedSessionsCount > 0 && (
                    <span className="absolute -right-2.5 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-background">
                      {completedBadgeText}
                    </span>
                  )}
                </span>
                {t('search.modeSessions')}
              </button>
              <Tooltip content={t('search.archiveOnlyTooltip', 'Archive only')} position="top">
                <button
                  onClick={() => onSearchModeChange('archived')}
                  aria-pressed={searchMode === 'archived'}
                  aria-label={t('search.archiveOnlyTooltip', 'Archive only')}
                  title={t('search.archiveOnlyTooltip', 'Archive only')}
                  className={cn(
                    "flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                    searchMode === 'archived'
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Archive className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
