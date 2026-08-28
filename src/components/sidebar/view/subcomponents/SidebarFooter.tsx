import { Settings, ArrowUpCircle, Bug, AlertTriangle } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReleaseInfo } from '../../../../types/sharedTypes';

import { DISCORD_INVITE_URL, DiscordIcon, GITHUB_ISSUES_URL } from './sidebarRailItems';

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5 md:px-2 md:py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden px-2 py-1.5 md:block">
            <button
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-blue-50/80 dark:hover:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-primary" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-primary">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-[10px] text-primary/70">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="px-3 py-2 md:hidden">
            <button
              className="flex h-11 w-full items-center gap-3 rounded-xl border border-blue-200/60 bg-blue-50/80 px-3.5 transition-all active:scale-[0.98] dark:border-blue-700/40 dark:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <ArrowUpCircle className="h-4 w-4 text-primary" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-primary">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-primary/70">
                  {t('version.updateAvailable')}
                </span>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Community + Settings (desktop lives in the Workbench rail bottom) */}
      <div className="nav-divider md:hidden" />

      {/* Mobile footer: icon-only trio (desktop moved to the Workbench rail
          bottom via getSidebarRailFooterItems). */}
      <div className="flex items-center justify-center gap-2 px-3 py-2 md:hidden">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
          title={t('actions.settings')}
          aria-label={t('actions.settings')}
        >
          <Settings className="h-4 w-4" />
        </button>
        <a
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          title={t('actions.reportIssue')}
          aria-label={t('actions.reportIssue')}
        >
          <Bug className="h-4 w-4" />
        </a>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          title={t('actions.joinCommunity')}
          aria-label={t('actions.joinCommunity')}
        >
          <DiscordIcon className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
