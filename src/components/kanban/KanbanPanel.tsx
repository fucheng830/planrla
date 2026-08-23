import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKanban } from './KanbanContext';
import { Board } from './Board';
import { CreateTaskDialog } from './CreateTaskDialog';
import { ParsePrdDialog } from './ParsePrdDialog';
import { TaskTemplateEditor } from './TaskTemplateEditor';
import { SchedulesDialog } from './SchedulesDialog';

import { Button } from '@/shared/view/ui';

export function KanbanPanel({ isVisible }: { isVisible: boolean }) {
  const { t } = useTranslation('kanban');
  const { rootId, loading, error, refresh, nextTask } = useKanban();
  // CreateTaskDialog and TaskTemplateEditor are mounted at the panel root so
  // their portaled overlays render above the board regardless of which column
  // owns focus. The buttons just toggle the flags on.
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [showParsePrd, setShowParsePrd] = useState(false);

  return (
    <div className={`${isVisible ? 'block' : 'hidden'} h-full`}>
      {!rootId ? (
        <EmptyState text={t('panel.emptyProject')} />
      ) : (
        <div className="flex h-full flex-col">
          <div className="ds-panel-header px-3">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              {t('panel.newTask')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowParsePrd(true)}>
              {t('panel.parsePrd')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowTemplates(true)}>
              {t('panel.templates')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowSchedules(true)}>
              {t('panel.schedules')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              {t('panel.refresh')}
            </Button>
            {loading && (
              <span className="text-xs text-muted-foreground">
                {t('panel.loading')}
              </span>
            )}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
          {nextTask && (
            <div className="flex items-center gap-2 border-b border-workbench-border bg-workbench-accent/5 px-3 py-1.5 text-xs">
              <span className="font-medium text-workbench-accent">{t('banner.nextTask')}</span>
              <span className="font-mono font-semibold">#{nextTask.taskNumber}</span>
              <span className="truncate text-muted-foreground">{nextTask.taskTemplateName}</span>
              {nextTask.priority === 'high' && (
                <span className="rounded bg-red-500/10 px-1 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                  {t('priority.high')}
                </span>
              )}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <Board />
          </div>
        </div>
      )}
      {showCreate && <CreateTaskDialog onClose={() => setShowCreate(false)} />}
      {showParsePrd && <ParsePrdDialog onClose={() => setShowParsePrd(false)} />}
      {showTemplates && (
        <TaskTemplateEditor onClose={() => setShowTemplates(false)} />
      )}
      {showSchedules && <SchedulesDialog onClose={() => setShowSchedules(false)} />}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
