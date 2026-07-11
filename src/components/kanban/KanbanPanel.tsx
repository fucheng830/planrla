import { useState } from 'react';
import { useKanban } from './KanbanContext';
import { Button } from '@/shared/view/ui';

export function KanbanPanel({ isVisible }: { isVisible: boolean }) {
  const { rootId, loading, error, refresh } = useKanban();
  // CreateTaskDialog (T6) and TaskTemplateEditor (T6) will consume these.
  // They're tracked now so the top-bar buttons are wired to real state rather
  // than being no-ops; the dialogs themselves land in a later task.
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <div className={`${isVisible ? 'block' : 'hidden'} h-full`}>
      {!rootId ? (
        <EmptyState text="Select a project to view its kanban board." />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
              New Task
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowTemplates((v) => !v)}>
              Templates
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              Refresh
            </Button>
            {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
            {error && <span className="text-xs text-destructive">{error}</span>}
            {showCreate && <span className="text-xs text-muted-foreground">create: on</span>}
            {showTemplates && <span className="text-xs text-muted-foreground">templates: on</span>}
          </div>
          <div className="flex-1 overflow-hidden">
            {/* Board (T4), CreateTaskDialog (T6), TaskTemplateEditor (T6) are wired in later tasks */}
            <EmptyState text="Kanban board (coming next)" />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}
