import { useState, useEffect, useRef } from 'react';
import type { MouseEvent, MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeEditorFile } from '../types/types';
import CodeEditor from './CodeEditor';
import EditorTabs from './subcomponents/EditorTabs';
import VideoPreviewPanel from './VideoPreviewPanel';
import { isVideoFile } from '../utils/binaryFile';

type EditorSidebarProps = {
  editingFile: CodeEditorFile | null;
  openFiles: CodeEditorFile[];
  activeFilePath: string | null;
  isMobile: boolean;
  editorExpanded: boolean;
  editorWidth: number;
  hasManualWidth: boolean;
  resizeHandleRef: MutableRefObject<HTMLDivElement | null>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onCloseEditor: () => void;
  onCloseFile: (filePath: string) => void;
  onSwitchFile: (filePath: string) => void;
  onToggleEditorExpand: () => void;
  projectPath?: string;
  fillSpace?: boolean;
};

// Minimum width for the left content (file tree, chat, etc.)
const MIN_LEFT_CONTENT_WIDTH = 200;
// Minimum width for the editor sidebar
const MIN_EDITOR_WIDTH = 280;

export default function EditorSidebar({
  editingFile,
  openFiles,
  activeFilePath,
  isMobile,
  editorExpanded,
  editorWidth,
  hasManualWidth,
  resizeHandleRef,
  onResizeStart,
  onCloseEditor,
  onCloseFile,
  onSwitchFile,
  onToggleEditorExpand,
  projectPath,
  fillSpace,
}: EditorSidebarProps) {
  const { t } = useTranslation('codeEditor');
  const [poppedOut, setPoppedOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [effectiveWidth, setEffectiveWidth] = useState(editorWidth);

  // Adjust editor width when container size changes to ensure buttons are always visible
  useEffect(() => {
    if (openFiles.length === 0 || isMobile || poppedOut) return;

    const updateWidth = () => {
      if (!containerRef.current) return;
      const parentElement = containerRef.current.parentElement;
      if (!parentElement) return;

      const containerWidth = parentElement.clientWidth;

      // Calculate maximum allowed editor width
      const maxEditorWidth = containerWidth - MIN_LEFT_CONTENT_WIDTH;

      if (maxEditorWidth < MIN_EDITOR_WIDTH) {
        // Not enough space - pop out the editor so user can still see everything
        setPoppedOut(true);
      } else if (editorWidth > maxEditorWidth) {
        // Editor is too wide - constrain it to ensure left content has space
        setEffectiveWidth(maxEditorWidth);
      } else {
        setEffectiveWidth(editorWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);

    // Also use ResizeObserver for more accurate detection
    const resizeObserver = new ResizeObserver(updateWidth);
    const parentEl = containerRef.current?.parentElement;
    if (parentEl) {
      resizeObserver.observe(parentEl);
    }

    return () => {
      window.removeEventListener('resize', updateWidth);
      resizeObserver.disconnect();
    };
  }, [openFiles.length, isMobile, poppedOut, editorWidth]);

  if (openFiles.length === 0) {
    return null;
  }

  const tabsBar = (
    <EditorTabs
      openFiles={openFiles}
      activeFilePath={activeFilePath}
      onSwitch={onSwitchFile}
      onClose={onCloseFile}
    />
  );
  const activeFile = editingFile ?? openFiles[0];
  const isVideoPreview = isVideoFile(activeFile.name);

  if (isMobile || poppedOut) {
    return (
      <div className="flex h-full flex-col">
        {tabsBar}
        {isVideoPreview ? (
          <VideoPreviewPanel file={activeFile} onClose={() => { setPoppedOut(false); onCloseEditor(); }} />
        ) : (
          <CodeEditor
            file={activeFile}
            onClose={() => { setPoppedOut(false); onCloseEditor(); }}
            projectPath={projectPath}
            isSidebar={false}
          />
        )}
      </div>
    );
  }

  // In files tab, fill the remaining width unless user has dragged manually.
  const useFlexLayout = editorExpanded || (fillSpace && !hasManualWidth);

  return (
    <div ref={containerRef} className={`flex h-full min-w-0 ${editorExpanded ? 'flex-1' : ''}`}>
      {!editorExpanded && (
        <div
          ref={resizeHandleRef}
          onMouseDown={onResizeStart}
          className="group relative w-1 flex-shrink-0 cursor-col-resize bg-workbench-border hover:bg-workbench-accent"
          title={t('toolbar.resize')}
        >
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-workbench-accent opacity-0 group-hover:opacity-100" />
        </div>
      )}

      <div
        className={`flex h-full flex-col overflow-hidden border-l border-workbench-border ${useFlexLayout ? 'min-w-0 flex-1' : 'flex-shrink-0'}`}
        style={useFlexLayout ? undefined : { width: `${effectiveWidth}px`, minWidth: `${MIN_EDITOR_WIDTH}px` }}
      >
        {tabsBar}
        {isVideoPreview ? (
          <VideoPreviewPanel file={activeFile} onClose={onCloseEditor} />
        ) : (
          <CodeEditor
            file={activeFile}
            onClose={onCloseEditor}
            projectPath={projectPath}
            isSidebar
            isExpanded={editorExpanded}
            onToggleExpand={onToggleEditorExpand}
            onPopOut={() => setPoppedOut(true)}
          />
        )}
      </div>
    </div>
  );
}
