import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useKanban } from './KanbanContext';
import type { TaskTemplate, StageTemplate } from './types';

function newStage(role: 'user' | 'agent'): StageTemplate {
  return {
    id: crypto.randomUUID(),
    name: role === 'user' ? 'New user stage' : 'New agent stage',
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
    id: crypto.randomUUID(),
    name: 'New template',
    maxConcurrency: 1,
    stages: [{ id: s.id, position: 0, snapshot: s }],
    createdAt: '',
    updatedAt: '',
  };
}

export function TaskTemplateEditor({ onClose }: { onClose: () => void }) {
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
        <DialogTitle className="sr-only">Task Templates</DialogTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Task Templates</h2>
            <Button size="sm" onClick={() => setEditing(emptyTemplate())}>
              <Plus className="mr-1 h-3 w-3" />
              New
            </Button>
          </div>
          {!editing && (
            <div className="space-y-1">
              {templates.length === 0 && (
                <div className="text-xs text-muted-foreground">No templates yet.</div>
              )}
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded border border-border p-2"
                >
                  <div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.stages.length} stages · concurrency {t.maxConcurrency}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(JSON.parse(JSON.stringify(t)))}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteTemplate(t.id)}
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
              onSave={async (t) => {
                await saveTemplate(t);
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
  const [t, setT] = useState<TaskTemplate>(tpl);

  const updateStage = (idx: number, patch: Partial<StageTemplate>) => {
    const stages = t.stages.slice();
    const cur = stages[idx];
    stages[idx] = { ...cur, snapshot: { ...cur.snapshot, ...patch } };
    setT({ ...t, stages });
  };
  const addStage = (role: 'user' | 'agent') => {
    const snapshot = newStage(role);
    setT({
      ...t,
      stages: [
        ...t.stages,
        { id: snapshot.id, position: t.stages.length, snapshot },
      ],
    });
  };
  const removeStage = (idx: number) =>
    setT({
      ...t,
      stages: t.stages
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, position: i })),
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={t.name}
          onChange={(e) => setT({ ...t, name: e.target.value })}
          className="flex-1"
        />
        <Input
          type="number"
          min={1}
          value={t.maxConcurrency}
          onChange={(e) =>
            setT({
              ...t,
              maxConcurrency: Math.max(1, Number(e.target.value) || 1),
            })
          }
          className="w-20"
          title="Max concurrency"
        />
      </div>
      <div className="space-y-2">
        {t.stages.map((st, i) => (
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
                <option value="user">user</option>
                <option value="agent">agent</option>
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
                  plan
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={st.snapshot.autoAdvance}
                    onChange={(e) => updateStage(i, { autoAdvance: e.target.checked })}
                  />
                  autoAdvance
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={st.snapshot.agentCanControlStage ?? true}
                    onChange={(e) =>
                      updateStage(i, { agentCanControlStage: e.target.checked })
                    }
                  />
                  self-drive
                </label>
              </div>
            )}
            <textarea
              value={st.snapshot.promptTemplate ?? ''}
              onChange={(e) => updateStage(i, { promptTemplate: e.target.value })}
              placeholder="Prompt template. Use {{input}}, {{task_id}}, {{task_number}}, {{stage_name}}…"
              className="w-full rounded border border-border bg-background p-1.5 font-mono text-xs"
              rows={2}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => addStage('user')}>
          <Plus className="mr-1 h-3 w-3" />
          User stage
        </Button>
        <Button size="sm" variant="outline" onClick={() => addStage('agent')}>
          <Plus className="mr-1 h-3 w-3" />
          Agent stage
        </Button>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onSave({
              ...t,
              stages: t.stages.map((s, i) => ({ ...s, position: i })),
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
