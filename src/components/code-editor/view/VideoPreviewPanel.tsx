import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Video, X } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';
import type { CodeEditorFile } from '../types/types';

type VideoPreviewPanelProps = {
  file: CodeEditorFile;
  onClose: () => void;
};

export default function VideoPreviewPanel({ file, onClose }: VideoPreviewPanelProps) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const endpoint = file.projectId
    ? `/api/projects/${file.projectId}/files/content?path=${encodeURIComponent(file.path)}`
    : null;

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadVideo = async () => {
      if (!endpoint) {
        setError('This file is missing its project context.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setSource(null);
        const response = await authenticatedFetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        setSource(objectUrl);
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === 'AbortError') return;
        setError('The video could not be loaded.');
      } finally {
        setLoading(false);
      }
    };

    void loadVideo();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint]);

  return (
    <section aria-label={`Video preview: ${file.name}`} className="flex h-full min-h-0 flex-col bg-workbench-canvas">
      <div className="ds-panel-header flex-shrink-0">
        <Video className="size-4 text-workbench-accent" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-workbench-ink">{file.name}</h2>
        <button type="button" onClick={onClose} className="ds-focus-ring rounded-md p-1 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label={`Close ${file.name}`}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-4">
        {loading && <Loader2 className="size-5 animate-spin text-white/70" aria-label="Loading video" />}
        {!loading && source && <video className="max-h-full max-w-full" src={source} controls playsInline />}
        {!loading && !source && (
          <div className="max-w-sm text-center text-sm text-white/80">
            <AlertCircle className="mx-auto mb-2 size-5 text-amber-300" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
      </div>
      <p className="ds-mono truncate border-t border-workbench-border bg-workbench-surface px-3 py-2 text-[11px] text-workbench-subtle" title={file.path}>
        {file.path}
      </p>
    </section>
  );
}
