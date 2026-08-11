import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project } from '../../../types/app';
import type { CodeEditorDiffInfo, CodeEditorFile } from '../types/types';

type UseEditorSidebarOptions = {
  selectedProject: Project | null;
  isMobile: boolean;
  initialWidth?: number;
};

export const useEditorSidebar = ({
  selectedProject,
  isMobile,
  initialWidth = 600,
}: UseEditorSidebarOptions) => {
  // Multi-file editor state: every opened file lives in `openFiles`, and
  // `activeFilePath` points at the tab currently shown in the editor. Opening
  // a file that is already open just activates its tab instead of replacing
  // the visible file, so users can keep several files side by side.
  const [openFiles, setOpenFiles] = useState<CodeEditorFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [editorWidth, setEditorWidth] = useState(initialWidth);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [hasManualWidth, setHasManualWidth] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  // The active file is derived for downstream consumers that still expect a
  // single CodeEditorFile (e.g. EditorSidebar's CodeEditor).
  const editingFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  const handleFileOpen = useCallback(
    (filePath: string, diffInfo: CodeEditorDiffInfo | null = null) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const fileName = normalizedPath.split('/').pop() || filePath;

      setOpenFiles((current) => {
        const existingIndex = current.findIndex((f) => f.path === filePath);
        // Already open: activate it and refresh its diffInfo (a later edit of
        // the same file should update the diff shown in that tab).
        if (existingIndex >= 0) {
          const next = current.slice();
          next[existingIndex] = { ...next[existingIndex], diffInfo };
          return next;
        }
        return [
          ...current,
          {
            name: fileName,
            path: filePath,
            projectId: selectedProject?.projectId,
            diffInfo,
          },
        ];
      });
      setActiveFilePath(filePath);
    },
    [selectedProject?.projectId],
  );

  const handleSwitchFile = useCallback((filePath: string) => {
    setActiveFilePath(filePath);
  }, []);

  const handleCloseFile = useCallback((filePath: string) => {
    setOpenFiles((current) => {
      const index = current.findIndex((f) => f.path === filePath);
      if (index < 0) return current;
      const next = current.slice();
      next.splice(index, 1);
      return next;
    });
    setActiveFilePath((current) => {
      if (current !== filePath) return current;
      // Activate the neighbour when closing the active tab.
      const remaining = openFiles.filter((f) => f.path !== filePath);
      if (remaining.length === 0) return null;
      const closedIndex = openFiles.findIndex((f) => f.path === filePath);
      const neighbourIndex = Math.min(closedIndex, remaining.length - 1);
      return remaining[Math.max(0, neighbourIndex)]?.path ?? null;
    });
  }, [openFiles]);

  const handleCloseEditor = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
    setEditorExpanded(false);
  }, []);

  const handleToggleEditorExpand = useCallback(() => {
    setEditorExpanded((previous) => !previous);
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }

      // After first drag interaction, the editor width is user-controlled.
      setHasManualWidth(true);
      setIsResizing(true);
      event.preventDefault();
    },
    [isMobile],
  );

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isResizing) {
        return;
      }

      // Get the main container (parent of EditorSidebar's parent) that contains both left content and editor
      const editorContainer = resizeHandleRef.current?.parentElement;
      const mainContainer = editorContainer?.parentElement;
      if (!mainContainer) {
        return;
      }

      const containerRect = mainContainer.getBoundingClientRect();
      // Calculate new editor width: distance from mouse to right edge of main container
      const newWidth = containerRect.right - event.clientX;

      const minWidth = 300;
      const maxWidth = containerRect.width * 0.8;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setEditorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return {
    editingFile,
    openFiles,
    activeFilePath,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseFile,
    handleSwitchFile,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  };
};
