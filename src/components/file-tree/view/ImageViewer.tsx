import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';
import type { FileTreeImageSelection } from '../types/types';

type ImageViewerProps = {
  file: FileTreeImageSelection;
  onClose: () => void;
};

export default function ImageViewer({ file, onClose }: ImageViewerProps) {
  const { t } = useTranslation('common');
  const imagePath = `/api/projects/${file.projectId}/files/content?path=${encodeURIComponent(file.path)}`;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        setImageUrl(null);

        const response = await authenticatedFetch(imagePath, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (loadError: unknown) {
        if (loadError instanceof Error && loadError.name === 'AbortError') {
          return;
        }
        console.error('Error loading image:', loadError);
        setError(t('imageViewer.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="ds-surface-raised flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md">
        <div className="ds-panel-header px-4">
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-workbench-ink">{file.name}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="size-8 p-0 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label={`Close ${file.name}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-[400px] items-center justify-center bg-workbench-canvas p-4">
          {loading && (
            <div className="text-center text-workbench-subtle">
              <p>{t('imageViewer.loading')}</p>
            </div>
          )}
          {!loading && imageUrl && (
            <img
              src={imageUrl}
              alt={file.name}
              className="max-h-[70vh] max-w-full rounded-md object-contain shadow-md"
            />
          )}
          {!loading && !imageUrl && (
            <div className="text-center text-workbench-subtle">
              <p>{error || t('imageViewer.loadFailed')}</p>
              <p className="mt-2 break-all text-sm">{file.path}</p>
            </div>
          )}
        </div>

        <div className="border-t border-workbench-border bg-workbench-surface p-3">
          <p className="ds-mono truncate text-[11px] text-workbench-subtle" title={file.path}>{file.path}</p>
        </div>
      </div>
    </div>
  );
}
