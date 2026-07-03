import type { ReactNode, RefObject } from 'react';
import { Folder, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileTreeNode, FileTreeViewMode } from '../types/types';
import type { VisibleNode } from '../utils/flattenVisibleNodes';
import FileTreeEmptyState from './FileTreeEmptyState';
import FileTreeList from './FileTreeList';

type FileTreeBodyProps = {
  /** 当前扁平化的可见节点（flattenVisibleNodes 输出，已应用展开状态）。 */
  visibleRows: VisibleNode[];
  /** 是否有任意根级条目已加载（用于区分“空项目”与“未加载”）。 */
  hasAnyEntries: boolean;
  searchQuery: string;
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNode) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNode) => void;
  onDelete?: (item: FileTreeNode) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  onRefresh?: () => void;
  onToggleDir?: (path: string) => void;
  isLoadingDir: (path: string) => boolean;
  errorOfDir: (path: string) => string | undefined;
  // Rename state for inline editing
  renamingItem?: FileTreeNode | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
  // 列表高度(外层容器 px 高度,虚拟化需要)
  height: number;
};

export default function FileTreeBody({
  visibleRows,
  hasAnyEntries,
  searchQuery,
  viewMode,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
  onRefresh,
  onToggleDir,
  isLoadingDir,
  errorOfDir,
  renamingItem,
  renameValue,
  setRenameValue,
  handleConfirmRename,
  handleCancelRename,
  renameInputRef,
  operationLoading,
  height,
}: FileTreeBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      {!hasAnyEntries ? (
        <FileTreeEmptyState
          icon={Folder}
          title={t('fileTree.noFilesFound')}
          description={t('fileTree.checkProjectPath')}
        />
      ) : visibleRows.length === 0 && searchQuery ? (
        <FileTreeEmptyState
          icon={Search}
          title={t('fileTree.noMatchesFound')}
          description={t('fileTree.tryDifferentSearch')}
        />
      ) : (
        <FileTreeList
          visibleRows={visibleRows}
          viewMode={viewMode}
          expandedDirs={expandedDirs}
          onItemClick={onItemClick}
          renderFileIcon={renderFileIcon}
          formatFileSize={formatFileSize}
          formatRelativeTime={formatRelativeTime}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onDownload={onDownload}
          onRefresh={onRefresh}
          onToggleDir={onToggleDir}
          isLoadingDir={isLoadingDir}
          errorOfDir={errorOfDir}
          renamingItem={renamingItem}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          handleConfirmRename={handleConfirmRename}
          handleCancelRename={handleCancelRename}
          renameInputRef={renameInputRef}
          operationLoading={operationLoading}
          height={height}
        />
      )}
    </>
  );
}
