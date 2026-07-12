import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useKanban } from './KanbanContext';
import type { TaskTemplate, StageTemplate } from './types';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // fallback for non-secure contexts (http on non-localhost) where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function newStage(role: 'user' | 'agent'): StageTemplate {
  return {
    id: uuid(),
    name: role === 'user' ? '新用户阶段' : '新 Agent 阶段',
    role,
    autoAdvance: role === 'user',
    agent: role === 'agent' ? 'claude' : undefined,
    promptTemplate: '',
    createdAt: '',
    updatedAt: '',
  };
}

function emptyTemplate(): TaskTemplate {
  const s = newStage('user');
  return {
    id: uuid(),
    name: '新模板',
    maxConcurrency: 1,
    stages: [{ id: s.id, position: 0, snapshot: s }],
    createdAt: '',
    updatedAt: '',
  };
}

export function TaskTemplateEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('kanban');
  const { templates, saveTemplate, deleteTemplate } = useKanban();
  const [editing, setEditing] = useState<TaskTemplate | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="sr-only">{t('editor.title')}</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('editor.title')}</h2>
            <Button size="sm" onClick={() => setEditing(emptyTemplate())}>
              <Plus className="mr-1 h-3 w-3" />
              {t('editor.newTemplate')}
            </Button>
          </div>
          {!editing && (
            <div className="space-y-1">
              {templates.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  {t('editor.noTemplates')}
                </div>
              )}
              {templates.map((tp) => (
                <div
                  key={tp.id}
                  className="flex items-center justify-between rounded border border-border p-2"
                >
                  <div>
                    <div className="text-sm font-medium">{tp.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('editor.stagesN', {
                        count: tp.stages.length,
                        n: tp.maxConcurrency,
                      })}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(JSON.parse(JSON.stringify(tp)))}
                    >
                      {t('editor.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteTemplate(tp.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {editing && (
            <TemplateForm
              tpl={editing}
              onCancel={() => setEditing(null)}
              onSave={async (tp) => {
                await saveTemplate(tp);
                setEditing(null);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  tpl,
  onSave,
  onCancel,
}: {
  tpl: TaskTemplate;
  onSave: (t: TaskTemplate) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('kanban');
  const [t2, setT] = useState<TaskTemplate>(tpl);

  const updateStage = (idx: number, patch: Partial<StageTemplate>) => {
    const stages = t2.stages.slice();
    const cur = stages[idx];
    stages[idx] = { ...cur, snapshot: { ...cur.snapshot, ...patch } };
    setT({ ...t2, stages });
  };
  const addStage = (role: 'user' | 'agent') => {
    const snapshot = newStage(role);
    setT({
      ...t2,
      stages: [
        ...t2.stages,
        { id: snapshot.id, position: t2.stages.length, snapshot },
      ],
    });
  };
  const removeStage = (idx: number) =>
    setT({
      ...t2,
      stages: t2.stages
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, position: i })),
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={t2.name}
          onChange={(e) => setT({ ...t2, name: e.target.value })}
          className="flex-1"
        />
        <Input
          type="number"
          min={1}
          value={t2.maxConcurrency}
          onChange={(e) =>
            setT({
              ...t2,
              maxConcurrency: Math.max(1, Number(e.target.value) || 1),
            })
          }
          className="w-20"
          title={t('editor.maxConcurrency')}
        />
      </div>
      <div className="space-y-2">
        {t2.stages.map((st, i) => (
          <div key={st.id} className="space-y-1 rounded border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">#{i}</span>
              <Input
                value={st.snapshot.name}
                onChange={(e) => updateStage(i, { name: e.target.value })}
                className="flex-1"
              />
              <select
                value={st.snapshot.role}
                onChange={(e) =>
                  updateStage(i, { role: e.target.value as 'user' | 'agent' })
                }
                className="rounded border border-border bg-background p-1 text-xs"
              >
                <option value="user">{t('role.user')}</option>
                <option value="agent">{t('role.agent')}</option>
              </select>
              <Button size="sm" variant="ghost" onClick={() => removeStage(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {st.snapshot.role === 'agent' && (
              <div className="flex flex-wrap items-center gap-2 pl-5">
                <select
                  value={st.snapshot.agent ?? 'claude'}
                  onChange={(e) => updateStage(i, { agent: e.target.value })}
                  className="rounded border border-border bg-background p-1 text-xs"
                >
                  {['claude', 'codex', 'cursor', 'gemini', 'opencode'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={st.snapshot.planMode ?? false}
                    onChange={(e) => updateStage(i, { planMode: e.target.checked })}
                  />
                  {t('editor.planMode')}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={st.snapshot.autoAdvance}
                    onChange={(e) => updateStage(i, { autoAdvance: e.target.checked })}
                  />
                  {t('editor.autoAdvance')}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={st.snapshot.agentCanControlStage ?? true}
                    onChange={(e) =>
                      updateStage(i, { agentCanControlStage: e.target.checked })
                    }
                  />
                  {t('editor.selfDrive')}
                </label>
              </div>
            )}
            <textarea
              value={st.snapshot.promptTemplate ?? ''}
              onChange={(e) => updateStage(i, { promptTemplate: e.target.value })}
              placeholder={t('editor.promptPlaceholder')}
              className="w-full rounded border border-border bg-background p-1.5 font-mono text-xs"
              rows={2}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => addStage('user')}>
          <Plus className="mr-1 h-3 w-3" />
          {t('editor.addUserStage')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => addStage('agent')}>
          <Plus className="mr-1 h-3 w-3" />
          {t('editor.addAgentStage')}
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('editor.cancel')}
        </Button>
        <Button
          onClick={() =>
            onSave({
              ...t2,
              stages: t2.stages.map((s, i) => ({ ...s, position: i })),
            })
          }
        >
          {t('editor.save')}
        </Button>
      </div>
    </div>
  );
}
