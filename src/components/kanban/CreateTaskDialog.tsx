import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';
import type { TaskPriority } from './types';

const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low'];

export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('kanban');
  const { tasks, templates, createTask } = useKanban();
  const [tplId, setTplId] = useState(templates[0]?.id ?? '');
  const defaultTplId = useMemo(() => templates[0]?.id ?? '', [templates]);
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dependencies, setDependencies] = useState<string[]>([]);

  // Templates load async and can be resynced after a failed create; if the
  // current selection is no longer in the list, fall back to the first one so
  // we never submit a stale template id.
  useEffect(() => {
    setTplId((prev) => (templates.some((tp) => tp.id === prev) ? prev : defaultTplId));
  }, [templates, defaultTplId]);

  // Dependency candidates: live tasks only (terminal ones already satisfy a
  // dependency, so offering them would be noise).
  const depCandidates = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'success' && task.status !== 'fail' && task.status !== 'cancelled',
      ),
    [tasks],
  );

  const toggleDep = (taskId: string) => {
    setDependencies((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const submit = async () => {
    if (!tplId) return;
    await createTask(tplId, input, { priority, dependencies });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="sr-only">{t('create.title')}</DialogTitle>
        <div className="space-y-3">
          <h2 className="text-base font-semibold">{t('create.title')}</h2>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              {t('create.template')}
            </div>
            {templates.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t('create.noTemplates')}
              </div>
            ) : (
              <select
                className="w-full rounded border border-border bg-background p-1.5 text-sm"
                value={tplId}
                onChange={(e) => setTplId(e.target.value)}
              >
                {templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              {t('create.input')}
            </div>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('create.inputPlaceholder')}
            />
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {t('create.inputHint', { input: '{{input}}' })}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              {t('create.priority')}
            </div>
            <select
              className="w-full rounded border border-border bg-background p-1.5 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </div>
          {depCandidates.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                {t('create.dependencies')}
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border p-2">
                {depCandidates.map((task) => (
                  <label
                    key={task.id}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={dependencies.includes(task.id)}
                      onChange={() => toggleDep(task.id)}
                    />
                    <span className="font-mono text-muted-foreground">
                      #{task.taskNumber}
                    </span>
                    <span className="truncate">
                      {task.taskTemplateName || task.id}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t('create.dependenciesHint')}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              {t('create.cancel')}
            </Button>
            <Button disabled={!tplId} onClick={submit}>
              {t('create.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
