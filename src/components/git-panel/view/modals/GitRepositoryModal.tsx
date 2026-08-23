import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import GitPanel from '../GitPanel';
import type { Project } from '../../../../types/app';

type GitRepositoryModalProps = {
  isOpen: boolean;
  selectedProject: Project | null;
  isMobile?: boolean;
  onClose: () => void;
  onFileOpen: (filePath: string) => void;
};

export default function GitRepositoryModal({
  isOpen,
  selectedProject,
  isMobile = false,
  onClose,
  onFileOpen,
}: GitRepositoryModalProps) {
  const { t } = useTranslation('common');

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !selectedProject) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div
        className="ds-surface-raised relative flex w-full max-w-5xl flex-col overflow-hidden rounded-md"
        style={{ height: isMobile ? '92vh' : '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-repository-title"
      >
        <div className="ds-panel-header px-4">
          <h2 id="git-repository-title" className="text-base font-semibold text-foreground">
            {t('gitPanel.repositoryModalTitle')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('gitPanel.dismissError')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={onFileOpen} />
        </div>
      </div>
    </div>
  );
}
