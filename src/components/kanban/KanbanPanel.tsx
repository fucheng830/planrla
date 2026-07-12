import { useState } from 'react';
import { useKanban } from './KanbanContext';
import { Button } from '@/shared/view/ui';
import { Board } from './Board';
import { CreateTaskDialog } from './CreateTaskDialog';
import { TaskTemplateEditor } from './TaskTemplateEditor';

export function KanbanPanel({ isVisible }: { isVisible: boolean }) {
  const { rootId, loading, error, refresh } = useKanban();
  // CreateTaskDialog and TaskTemplateEditor are mounted at the panel root so
  // their portaled overlays render above the board regardless of which column
  // owns focus. The buttons just toggle the flags on.
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <div className={`${isVisible ? 'block' : 'hidden'} h-full`}>
      {!rootId ? (
        <EmptyState text="Select a project to view its kanban board." />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              New Task
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowTemplates(true)}>
              Templates
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              Refresh
            </Button>
            {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
          <div className="flex-1 overflow-hidden">
            <Board />
          </div>
        </div>
      )}
      {showCreate && <CreateTaskDialog onClose={() => setShowCreate(false)} />}
      {showTemplates && <TaskTemplateEditor onClose={() => setShowTemplates(false)} />}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}
