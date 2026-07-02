import type { ReactNode, RefObject } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import type { VisibleNode } from '../utils/flattenVisibleNodes';
import FileTreeNode from './FileTreeNode';

const ROW_HEIGHT_BY_MODE: Record<FileTreeViewMode, number> = {
  simple: 28,
  compact: 24,
  detailed: 40,
};

type FileTreeListProps = {
  visibleRows: VisibleNode[];
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  onToggleDir?: (path: string) => void;
  isLoadingDir: (path: string) => boolean;
  errorOfDir: (path: string) => string | undefined;
  // Rename state
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
  // 列表高度(外层容器 px 高度,虚拟化需要)
  height: number;
};

export default function FileTreeList(props: FileTreeListProps) {
  const {
    visibleRows, viewMode, expandedDirs, onItemClick, renderFileIcon,
    formatFileSize, formatRelativeTime, onRename, onDelete, onNewFile, onNewFolder,
    onCopyPath, onDownload, onRefresh, onToggleDir, isLoadingDir, errorOfDir,
    renamingItem, renameValue, setRenameValue, handleConfirmRename, handleCancelRename,
    renameInputRef, operationLoading, height,
  } = props;

  const rowHeight = ROW_HEIGHT_BY_MODE[viewMode];

  const renderRow = ({ index, style }: ListChildComponentProps) => {
    const { node, level } = visibleRows[index];
    return (
      <div style={style}>
        <FileTreeNode
          key={node.path}
          item={node}
          level={level}
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
          isLoading={isLoadingDir(node.path)}
          errorMessage={errorOfDir(node.path)}
          renamingItem={renamingItem}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          handleConfirmRename={handleConfirmRename}
          handleCancelRename={handleCancelRename}
          renameInputRef={renameInputRef}
          operationLoading={operationLoading}
        />
      </div>
    );
  };

  return (
    <List
      height={height}
      itemCount={visibleRows.length}
      itemSize={rowHeight}
      width="100%"
      overscanCount={10}
    >
      {renderRow}
    </List>
  );
}
