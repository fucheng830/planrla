import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, X, Loader2, Folder, Upload } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { ICON_SIZE_CLASS, getFileIconData } from '../constants/fileIcons';
import { useExpandedDirectories } from '../hooks/useExpandedDirectories';
import { useFileTreeData } from '../hooks/useFileTreeData';
import { useFileTreeOperations } from '../hooks/useFileTreeOperations';
import { useFileTreeViewMode } from '../hooks/useFileTreeViewMode';
import { useFileTreeUpload } from '../hooks/useFileTreeUpload';
import { useFileTreeSearch } from '../hooks/useFileTreeSearch';
import type { FileTreeImageSelection, FileTreeNode } from '../types/types';
import { flattenVisibleNodes } from '../utils/flattenVisibleNodes';
import { pathToDirKey } from '../utils/pathToDirKey';
import { formatFileSize, formatRelativeTime, isImageFile } from '../utils/fileTreeUtils';
import { Project } from '../../../types/app';
import { Input } from '../../../shared/view/ui';
import { measure } from '../../../shared/perf/timing';

import FileTreeBody from './FileTreeBody';
import FileTreeDetailedColumns from './FileTreeDetailedColumns';
import FileTreeHeader from './FileTreeHeader';
import FileTreeLoadingState from './FileTreeLoadingState';
import FileTreeUploadProgress from './FileTreeUploadProgress';
import ImageViewer from './ImageViewer';


type FileTreeProps = {
  selectedProject: Project | null;
  onFileOpen?: (filePath: string) => void;
};

export default function FileTree({ selectedProject, onFileOpen }: FileTreeProps) {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Show toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const { entriesByDir, loadingDir, errorDir, ensureDir, refreshAll } = useFileTreeData(selectedProject);
  const { viewMode, changeViewMode } = useFileTreeViewMode();
  const { expandedDirs, toggleDirectory, collapseAll } = useExpandedDirectories();
  // 搜索适配增量缓存（FT10）：搜所有已缓存目录的 entries（含未展开但已 fetch 的）。
  const { searchQuery, setSearchQuery, filteredNodes, isSearching } = useFileTreeSearch({ entriesByDir });

  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';

  // File operations
  const operations = useFileTreeOperations({
    selectedProject,
    onRefresh: refreshAll,
    showToast,
  });

  // File upload (drag and drop)
  const upload = useFileTreeUpload({
    selectedProject,
    onRefresh: refreshAll,
    showToast,
  });
  const operationLoading = operations.operationLoading || upload.operationLoading;

  // Focus input when creating new item
  useEffect(() => {
    if (operations.isCreating && newItemInputRef.current) {
      newItemInputRef.current.focus();
      newItemInputRef.current.select();
    }
  }, [operations.isCreating]);

  // Focus input when renaming
  useEffect(() => {
    if (operations.renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [operations.renamingItem]);

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  // 展开目录:toggle + 展开时触发懒 fetch(ensureDir)。
  // dirKey 一致性:node.path(绝对) → pathToDirKey → 相对项目根 dir key;
  // 必须与 flattenVisibleNodes 内部 name 累积 + useFileTreeData.fetchDir(dir) 一致。
  // 性能测点 file-tree-expand:包 toggle + ensureDir(同步调度 fetch)。
  // 注:ensureDir 返回 void(异步 fetch 在内部触发,不返回 promise),故用同步 measure;
  // fetch 耗时由 loadingDir 态独立跟踪。
  const handleToggleDir = useCallback(
    (absPath: string) => {
      measure('file-tree-expand', () => {
        toggleDirectory(absPath);
        // toggleDirectory 是异步 setState;用 !expandedDirs.has 判断"将展开"。
        if (!expandedDirs.has(absPath)) {
          ensureDir(pathToDirKey(absPath, projectRoot));
        }
      });
    },
    [expandedDirs, toggleDirectory, ensureDir, projectRoot],
  );

  // Centralized click behavior keeps file actions identical across all presentation modes.
  const handleItemClick = useCallback(
    (item: FileTreeNode) => {
      if (item.type === 'directory') {
        handleToggleDir(item.path);
        return;
      }

      if (isImageFile(item.name) && selectedProject) {
        setSelectedImage({
          name: item.name,
          path: item.path,
          projectPath: selectedProject.path,
          // Image URL uses the DB projectId so ImageViewer can hit the
          // /api/projects/:projectId/files/content endpoint directly.
          projectId: selectedProject.projectId,
        });
        return;
      }

      onFileOpen?.(item.path);
    },
    [onFileOpen, selectedProject, handleToggleDir],
  );

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  // 扁平化可见节点(FT5):增量缓存 + 展开状态 → DFS 可见列表。
  const visibleRows = useMemo(
    () => flattenVisibleNodes(entriesByDir, expandedDirs, projectRoot),
    [entriesByDir, expandedDirs, projectRoot],
  );

  // 搜索态：用 filteredNodes 扁平渲染（level 0，作为搜索结果列表）；
  // 非搜索态：用 visibleRows（树）。FT10。
  const rows = useMemo(
    () =>
      isSearching
        ? filteredNodes.map((node) => ({ node, level: 0 }))
        : visibleRows,
    [isSearching, filteredNodes, visibleRows],
  );

  const hasAnyEntries = entriesByDir.size > 0;

  // loading 态:根目录缓存未就绪 → 全屏 loading 占位。
  const rootLoading = loadingDir.has('') && entriesByDir.size === 0;

  // 容器测高(react-window 需 px height)。
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 节点 path(绝对) → dirKey 后查 loading/error。
  const isLoadingDir = useCallback(
    (absPath: string) => loadingDir.has(pathToDirKey(absPath, projectRoot)),
    [loadingDir, projectRoot],
  );
  const errorOfDir = useCallback(
    (absPath: string) => errorDir.get(pathToDirKey(absPath, projectRoot)),
    [errorDir, projectRoot],
  );

  if (rootLoading) {
    return <FileTreeLoadingState />;
  }

  return (
    <div
      ref={upload.treeRef}
      className="relative flex h-full flex-col bg-background"
      onDragEnter={upload.handleDragEnter}
      onDragOver={upload.handleDragOver}
      onDragLeave={upload.handleDragLeave}
      onDrop={upload.handleDrop}
    >
      {/* Drag overlay */}
      {upload.isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10">
          <div className="flex items-center gap-3 rounded-lg bg-background/95 px-6 py-4 shadow-lg">
            <Upload className="h-6 w-6 text-blue-500" />
            <span className="text-sm font-medium">{t('fileTree.dropToUpload', 'Drop files to upload')}</span>
          </div>
        </div>
      )}

      <FileTreeHeader
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onUploadFiles={upload.handleFileSelect}
        onNewFile={() => operations.handleStartCreate('', 'file')}
        onNewFolder={() => operations.handleStartCreate('', 'directory')}
        onRefresh={refreshAll}
        onCollapseAll={collapseAll}
        loading={rootLoading}
        operationLoading={operationLoading}
        isUploading={upload.uploadProgress?.status === 'uploading'}
        uploadProgress={upload.uploadProgress?.progress ?? null}
      />

      <FileTreeUploadProgress upload={upload.uploadProgress} />

      {viewMode === 'detailed' && rows.length > 0 && <FileTreeDetailedColumns />}

      {/*
        List region: plain flex column, NO ScrollArea.
        react-window's FixedSizeList owns its own scroll viewport (overflow on its inner div);
        wrapping it in ScrollArea (which renders an extra overflow-auto div) created two nested
        scroll containers — wheel events conflicted and react-window could not be the scroll parent.
        The containerRef div below is measured via ResizeObserver and feeds containerHeight to the list.
      */}
      <div className="flex flex-1 min-h-0 flex-col px-2 py-1">
        {/* New item input */}
        {operations.isCreating && (
          <div
            className="mb-1 flex items-center gap-1.5 py-[3px] pr-2"
            style={{ paddingLeft: `${(operations.newItemParent.split('/').length - 1) * 16 + 4}px` }}
          >
            {operations.newItemType === 'directory' ? (
              <Folder className={cn(ICON_SIZE_CLASS, 'text-blue-500')} />
            ) : (
              <span className="ml-[18px]">{renderFileIcon(operations.newItemName)}</span>
            )}
            <Input
              ref={newItemInputRef}
              type="text"
              value={operations.newItemName}
              onChange={(e) => operations.setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') operations.handleConfirmCreate();
                if (e.key === 'Escape') operations.handleCancelCreate();
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (operations.isCreating) operations.handleConfirmCreate();
                }, 100);
              }}
              className="h-6 flex-1 text-sm"
              disabled={operationLoading}
            />
          </div>
        )}

        <div ref={containerRef} className="flex-1 min-h-0 min-w-0">
          <FileTreeBody
            visibleRows={rows}
            hasAnyEntries={hasAnyEntries}
            searchQuery={searchQuery}
            viewMode={viewMode}
            expandedDirs={expandedDirs}
            onItemClick={handleItemClick}
            renderFileIcon={renderFileIcon}
            formatFileSize={formatFileSize}
            formatRelativeTime={formatRelativeTimeLabel}
            onRename={operations.handleStartRename}
            onDelete={operations.handleStartDelete}
            onNewFile={(path) => operations.handleStartCreate(path, 'file')}
            onNewFolder={(path) => operations.handleStartCreate(path, 'directory')}
            onCopyPath={operations.handleCopyPath}
            onDownload={operations.handleDownload}
            onRefresh={refreshAll}
            onToggleDir={handleToggleDir}
            isLoadingDir={isLoadingDir}
            errorOfDir={errorOfDir}
            // Pass rename state and handlers for inline editing
            renamingItem={operations.renamingItem}
            renameValue={operations.renameValue}
            setRenameValue={operations.setRenameValue}
            handleConfirmRename={operations.handleConfirmRename}
            handleCancelRename={operations.handleCancelRename}
            renameInputRef={renameInputRef}
            operationLoading={operationLoading}
            height={containerHeight}
          />
        </div>
      </div>

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {operations.deleteConfirmation.isOpen && operations.deleteConfirmation.item && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">
                  {t('fileTree.delete.title', 'Delete {{type}}', {
                    type: operations.deleteConfirmation.item.type === 'directory' ? 'Folder' : 'File'
                  })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {operations.deleteConfirmation.item.name}
                </p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {operations.deleteConfirmation.item.type === 'directory'
                ? t('fileTree.delete.folderWarning', 'This folder and all its contents will be permanently deleted.')
                : t('fileTree.delete.fileWarning', 'This file will be permanently deleted.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={operations.handleCancelDelete}
                disabled={operationLoading}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={operations.handleConfirmDelete}
                disabled={operationLoading}
                className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {operationLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('fileTree.delete.confirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-[9999] px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2',
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          )}
        >
          {toast.type === 'success' ? (
            <Check className="h-4 w-4" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
