import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import type { CodeEditorFile } from '../../types/types';

type EditorTabsProps = {
  openFiles: CodeEditorFile[];
  activeFilePath: string | null;
  onSwitch: (filePath: string) => void;
  onClose: (filePath: string) => void;
};

/**
 * Horizontal tab bar for the multi-file editor. Each open file is a tab;
 * clicking a tab activates it, the × closes it. The bar scrolls horizontally
 * when there are more tabs than fit.
 */
export default function EditorTabs({ openFiles, activeFilePath, onSwitch, onClose }: EditorTabsProps) {
  const { t } = useTranslation('codeEditor');

  if (openFiles.length === 0) return null;

  return (
    <div className="flex items-stretch overflow-x-auto border-b border-workbench-border bg-workbench-surface">
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath;
        return (
          <div
            key={file.path}
            role="tab"
            tabIndex={0}
            onClick={() => onSwitch(file.path)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(file.path); } }}
            title={file.path}
            className={[
              'group flex flex-shrink-0 cursor-pointer items-center gap-1.5 border-r border-workbench-border px-3 py-1.5 text-xs transition-colors',
              isActive
                ? 'bg-workbench-muted font-medium text-workbench-ink'
                : 'text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink',
            ].join(' ')}
          >
            <span className="max-w-32 truncate">{file.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(file.path); }}
              className="flex h-4 w-4 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              aria-label={t('actions.close', { defaultValue: 'Close' })}
              title={t('actions.close', { defaultValue: 'Close' })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
