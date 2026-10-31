import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKanban } from './KanbanContext';
import { kanbanApi } from './api';

import { Dialog, DialogContent, DialogTitle, Button } from './ui';

const PROVIDERS = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'kimi'] as const;

export function ParsePrdDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('kanban');
  const { rootId, templates, refresh } = useKanban();
  const [tplId, setTplId] = useState(templates[0]?.id ?? '');
  const [provider, setProvider] = useState<string>('claude');
  const [prd, setPrd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!rootId || !tplId || !prd.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await kanbanApi.parsePrd(rootId, tplId, prd, provider);
      await refresh();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="sr-only">{t('prd.title')}</DialogTitle>
        <div className="space-y-3">
          <h2 className="text-base font-semibold">{t('prd.title')}</h2>
          <div className="flex gap-3">
            <div className="flex-1">
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
            <div className="flex-1">
              <div className="mb-1 text-xs text-muted-foreground">
                {t('prd.provider')}
              </div>
              <select
                className="w-full rounded border border-border bg-background p-1.5 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              {t('prd.input')}
            </div>
            <textarea
              className="h-48 w-full resize-none rounded border border-border bg-background p-2 font-mono text-xs"
              value={prd}
              onChange={(e) => setPrd(e.target.value)}
              placeholder={t('prd.placeholder')}
              disabled={busy}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t('prd.hint')}
            </div>
          </div>
          {error && (
            <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('create.cancel')}
            </Button>
            <Button disabled={!tplId || !prd.trim() || busy} onClick={() => void submit()}>
              {busy ? t('prd.submitting') : t('prd.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
