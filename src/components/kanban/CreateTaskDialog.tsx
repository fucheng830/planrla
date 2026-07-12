import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';

export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('kanban');
  const { templates, createTask } = useKanban();
  const [tplId, setTplId] = useState(templates[0]?.id ?? '');
  const [input, setInput] = useState('');

  const submit = async () => {
    if (!tplId) return;
    await createTask(tplId, input);
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
