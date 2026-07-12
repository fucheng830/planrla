import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Button, Input } from '@/shared/view/ui';
import { useKanban } from './KanbanContext';

export function CreateTaskDialog({ onClose }: { onClose: () => void }) {
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
        <DialogTitle className="sr-only">New Task</DialogTitle>
        <div className="space-y-3">
          <h2 className="text-base font-semibold">New Task</h2>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Template</div>
            {templates.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No templates. Create one in the Templates editor first.
              </div>
            ) : (
              <select
                className="w-full rounded border border-border bg-background p-1.5 text-sm"
                value={tplId}
                onChange={(e) => setTplId(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              Input (passed to the task as &#123;&#123;input&#125;&#125;)
            </div>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. implement feature X"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!tplId} onClick={submit}>
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
