import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useKanban } from './KanbanContext';
import type { KanbanSchedule } from './types';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // fallback for non-secure contexts (http on non-localhost) where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// New schedules are given a fresh id so the server's saveSchedule inserts rather
// than overwrites. taskTemplateId defaults to the first available template so the
// dropdown isn't empty on a brand-new project with exactly one template.
function emptySchedule(rootId: string, taskTemplateId: string): KanbanSchedule {
  return {
    id: uuid(),
    rootId,
    taskTemplateId,
    cronExpression: '',
    enabled: true,
    input: '',
    lastRunAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

// Permissive 5-field cron shape check. Each field is a comma-separated list of
// terms; a term is "*", "n", "n-m", "n-m/s", "*/s", or a short token (JAN/MON…).
// Intentionally loose on value ranges — the server's node-cron.validate() is the
// final arbiter of semantics, so the frontend just catches obvious typos early.
const CRON_TERM = '\\*(?:\\/\\d{1,3})?|(?:\\d{1,2}|[A-Za-z]{1,3})(?:-\\d{1,2}|-[A-Za-z]{1,3})?(?:\\/\\d{1,3})?';
const CRON_FIELD_RE = new RegExp(`^(?:${CRON_TERM})(?:,(?:${CRON_TERM}))*$`);

function isValidCron5(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f) => CRON_FIELD_RE.test(f));
}

export function SchedulesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('kanban');
  const { rootId, templates, schedules, saveSchedule, deleteSchedule } = useKanban();
  const [editing, setEditing] = useState<KanbanSchedule | null>(null);

  const templateName = (id: string) =>
    templates.find((tp) => tp.id === id)?.name ?? t('schedules.templateMissing');

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="sr-only">{t('schedules.title')}</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('schedules.title')}</h2>
            <Button
              size="sm"
              onClick={() => setEditing(emptySchedule(rootId ?? '', templates[0]?.id ?? ''))}
            >
              <Plus className="mr-1 h-3 w-3" />
              {t('schedules.newSchedule')}
            </Button>
          </div>
          {!editing && (
            <div className="space-y-1">
              {schedules.length === 0 && (
                <div className="text-xs text-muted-foreground">{t('schedules.noSchedules')}</div>
              )}
              {schedules.map((sch) => (
                <div
                  key={sch.id}
                  className="flex items-center justify-between rounded border border-border p-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="font-mono">{sch.cronExpression || '—'}</span>
                      {!sch.enabled && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('schedules.disabled')}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t('schedules.listHint', {
                        template: templateName(sch.taskTemplateId),
                        input: sch.input || '—',
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(JSON.parse(JSON.stringify(sch)))}
                    >
                      {t('schedules.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteSchedule(sch.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {editing && (
            <ScheduleForm
              sch={editing}
              onCancel={() => setEditing(null)}
              onSave={async (s) => {
                await saveSchedule(s);
                setEditing(null);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  sch,
  onSave,
  onCancel,
}: {
  sch: KanbanSchedule;
  onSave: (s: KanbanSchedule) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('kanban');
  const { templates } = useKanban();
  const [s, setS] = useState<KanbanSchedule>(sch);

  const cronValue = s.cronExpression.trim();
  const cronValid = isValidCron5(cronValue);
  const showCronError = cronValue.length > 0 && !cronValid;
  const templateEmpty = s.taskTemplateId.trim().length === 0;
  const canSave = cronValid && !templateEmpty;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t('schedules.cron')}</label>
        <Input
          value={s.cronExpression}
          onChange={(e) => setS({ ...s, cronExpression: e.target.value })}
          placeholder={t('schedules.cronPlaceholder')}
          className="font-mono"
          aria-invalid={showCronError || undefined}
        />
        {showCronError ? (
          <div className="text-[10px] text-destructive">{t('schedules.cronError')}</div>
        ) : (
          <div className="font-mono text-[10px] text-muted-foreground">{t('schedules.cronHint')}</div>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t('schedules.template')}</label>
        {templates.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t('schedules.noTemplates')}</div>
        ) : (
          <select
            value={s.taskTemplateId}
            onChange={(e) => setS({ ...s, taskTemplateId: e.target.value })}
            className="w-full rounded border border-border bg-background p-1.5 text-sm"
          >
            {templates.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t('schedules.input')}</label>
        <Input
          value={s.input}
          onChange={(e) => setS({ ...s, input: e.target.value })}
          placeholder={t('schedules.inputPlaceholder')}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => setS({ ...s, enabled: e.target.checked })}
        />
        {t('schedules.enabled')}
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('schedules.cancel')}
        </Button>
        <Button onClick={() => onSave(s)} disabled={!canSave}>
          {t('schedules.save')}
        </Button>
      </div>
    </div>
  );
}
