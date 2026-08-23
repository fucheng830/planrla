import { useTranslation } from 'react-i18next';
import type { MainContentStateViewProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import { WorkbenchEmptyState } from '../../../workbench';

export default function MainContentStateView({ mode, isMobile, onMenuClick }: MainContentStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-sm sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        <WorkbenchEmptyState
          title={t('mainContent.chooseProject')}
          description={`${t('mainContent.selectProjectDescription')} ${isMobile ? t('mainContent.createProjectMobile') : t('mainContent.createProjectDesktop')}`}
          action={
            <button type="button" onClick={onMenuClick} className="ds-focus-ring rounded-md bg-workbench-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              {t('mainContent.browseProjects', 'Browse projects')}
            </button>
          }
        />
      )}
    </div>
  );
}
