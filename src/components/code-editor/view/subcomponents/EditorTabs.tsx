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
    <div className="flex items-stretch overflow-x-auto border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
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
              'group flex flex-shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-200 px-3 py-1.5 text-xs transition-colors dark:border-gray-700',
              isActive
                ? 'bg-white font-medium text-foreground dark:bg-gray-900 dark:text-gray-100'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200',
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
