import { EditorView } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useCodeEditorDocument } from '../hooks/useCodeEditorDocument';
import { useCodeEditorSettings } from '../hooks/useCodeEditorSettings';
import { useEditorKeyboardShortcuts } from '../hooks/useEditorKeyboardShortcuts';
import type { CodeEditorFile } from '../types/types';
import { createMinimapExtension, createScrollToFirstChunkExtension, getLanguageExtensions } from '../utils/editorExtensions';
import { getEditorStyles } from '../utils/editorStyles';
import { createEditorToolbarPanelExtension } from '../utils/editorToolbarPanel';
import CodeEditorFooter from './subcomponents/CodeEditorFooter';
import CodeEditorHeader from './subcomponents/CodeEditorHeader';
import CodeEditorLoadingState from './subcomponents/CodeEditorLoadingState';
import CodeEditorSurface from './subcomponents/CodeEditorSurface';
import CodeEditorBinaryFile from './subcomponents/CodeEditorBinaryFile';

// REQ-047 — AI 选段改插槽(可选)。仅 MarkdownEditorPanel 传入 enableAiEdit=true,
// 其余 caller 不传,行为完全不变。slot 由 useAiSelectionEdit 提供。
export type AiEditSlot = {
  onSelectionChange: (selectedText: string, range: { from: number; to: number } | null) => void;
  trigger: () => void;
  submitPrompt: (instruction: string) => void;
  cancelInstruction: () => void;
  cancelRun: () => void;
  accept: () => void;
  reject: () => void;
  status: 'idle' | 'running' | 'success' | 'error';
  hasSelection: boolean;
  hasAiDiff: boolean;
  awaitingInstruction: boolean;
  message: string | null;
};

type CodeEditorProps = {
  file: CodeEditorFile;
  onClose: () => void;
  projectPath?: string;
  isSidebar?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (() => void) | null;
  onPopOut?: (() => void) | null;
  // REQ-047 — 启用 AI 选段改(默认 false,现有 caller 零影响)。
  enableAiEdit?: boolean;
  aiEditSlot?: AiEditSlot | null;
  // REQ-047 — 当 AI diff 拒绝时,父组件用此还原编辑器内容到 old_full。
  onRevertContent?: (content: string) => void;
  // REQ-047 — 工具栏右侧自定义渲染位(放 AiEditControls)。
  toolbarExtra?: React.ReactNode;
  // REQ-047 — AI 接受后清 diffInfo 但保留 content(避免重新读盘覆盖 AI 改后的文本)。
  retainContentOnDiffClear?: boolean;
};

// REQ-047 — 命令式句柄。MarkdownEditorPanel 用 ref 操作编辑器内容(AI 接受/拒绝)。
// 现有 caller 不用 ref(默认导出仍是 forwardRef 组件,ref 可选)。
export type CodeEditorHandle = {
  getContent: () => string;
  setContent: (content: string) => void;
};

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    file,
    onClose,
    projectPath,
    isSidebar = false,
    isExpanded = false,
    onToggleExpand = null,
    onPopOut = null,
    enableAiEdit = false,
    aiEditSlot = null,
    onRevertContent = null,
    toolbarExtra = null,
    retainContentOnDiffClear = false,
  },
  ref,
) {
  const { t } = useTranslation('codeEditor');
  const paletteOps = usePaletteOps();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDiff, setShowDiff] = useState(Boolean(file.diffInfo));
  const [markdownPreview, setMarkdownPreview] = useState(false);

  const {
    isDarkMode,
    wordWrap,
    minimapEnabled,
    showLineNumbers,
    fontSize,
  } = useCodeEditorSettings();

  const {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    handleSave,
    handleDownload,
  } = useCodeEditorDocument({
    file,
    projectPath,
    retainContentOnDiffClear,
  });

  // REQ-047 — 暴露命令式句柄给 MarkdownEditorPanel(AI 接受/拒绝操作 content)。
  // contentRef 让回调始终读最新 content(避免闭包陷阱)。
  const contentRef = useRef(content);
  contentRef.current = content;
  useImperativeHandle(ref, () => ({
    getContent: () => contentRef.current,
    setContent: (next: string) => setContent(next),
  }), [setContent]);

  const isMarkdownFile = useMemo(() => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension === 'md' || extension === 'markdown';
  }, [file.name]);

  const minimapExtension = useMemo(
    () => (
      createMinimapExtension({
        file,
        showDiff,
        minimapEnabled,
        isDarkMode,
      })
    ),
    [file, isDarkMode, minimapEnabled, showDiff],
  );

  const scrollToFirstChunkExtension = useMemo(
    () => createScrollToFirstChunkExtension({ file, showDiff }),
    [file, showDiff],
  );

  const toolbarPanelExtension = useMemo(
    () => (
      createEditorToolbarPanelExtension({
        file,
        showDiff,
        isSidebar,
        isExpanded,
        onToggleDiff: () => setShowDiff((previous) => !previous),
        onPopOut,
        onToggleExpand,
        labels: {
          changes: t('toolbar.changes'),
          previousChange: t('toolbar.previousChange'),
          nextChange: t('toolbar.nextChange'),
          hideDiff: t('toolbar.hideDiff'),
          showDiff: t('toolbar.showDiff'),
          collapse: t('toolbar.collapse'),
          expand: t('toolbar.expand'),
        },
      })
    ),
    [file, isExpanded, isSidebar, onPopOut, onToggleExpand, showDiff, t],
  );

  // REQ-047 — AI 选段改:监听 CodeMirror 选区变化,通知 useAiSelectionEdit。
  // 仅 enableAiEdit 时构造;updateListener 是稳定的 extension(API),ref 持有 slot。
  const aiSlotRef = useRef(aiEditSlot);
  aiSlotRef.current = aiEditSlot;
  const aiSelectionExtension = useMemo<Extension | null>(() => {
    if (!enableAiEdit) return null;
    return EditorView.updateListener.of((viewUpdate) => {
      const slot = aiSlotRef.current;
      if (!slot) return;
      // 只在选区变化时上报,避免每个 doc 变更都触发。
      if (!viewUpdate.selectionSet && !viewUpdate.docChanged) return;
      const { from, to } = viewUpdate.state.selection.main;
      if (from === to) {
        slot.onSelectionChange('', null);
        return;
      }
      const selectedText = viewUpdate.state.sliceDoc(from, to);
      slot.onSelectionChange(selectedText, { from, to });
    });
  }, [enableAiEdit]);

  const extensions = useMemo(() => {
    const allExtensions: Extension[] = [
      ...getLanguageExtensions(file.name),
      ...toolbarPanelExtension,
    ];

    if (aiSelectionExtension) {
      allExtensions.push(aiSelectionExtension);
    }

    if (file.diffInfo && showDiff && file.diffInfo.old_string !== undefined) {
      allExtensions.push(
        unifiedMergeView({
          original: file.diffInfo.old_string,
          mergeControls: false,
          highlightChanges: true,
          syntaxHighlightDeletions: false,
          gutter: true,
        }),
      );
      allExtensions.push(...minimapExtension);
      allExtensions.push(...scrollToFirstChunkExtension);
    }

    if (wordWrap) {
      allExtensions.push(EditorView.lineWrapping);
    }

    return allExtensions;
  }, [
    aiSelectionExtension,
    file.diffInfo,
    file.name,
    minimapExtension,
    scrollToFirstChunkExtension,
    showDiff,
    toolbarPanelExtension,
    wordWrap,
  ]);

  useEditorKeyboardShortcuts({
    onSave: handleSave,
    onClose,
    dependency: content,
  });

  if (loading) {
    return (
      <CodeEditorLoadingState
        isDarkMode={isDarkMode}
        isSidebar={isSidebar}
        loadingText={t('loading', { fileName: file.name })}
      />
    );
  }

  // Binary file display
  if (isBinary) {
    return (
      <CodeEditorBinaryFile
        file={file}
        isSidebar={isSidebar}
        isFullscreen={isFullscreen}
        onClose={onClose}
        onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
        title={t('binaryFile.title', 'Binary File')}
        message={t('binaryFile.message', 'The file "{{fileName}}" cannot be displayed in the text editor because it is a binary file.', { fileName: file.name })}
      />
    );
  }

  const outerContainerClassName = isSidebar
    ? 'w-full h-full flex flex-col'
    : `fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4 ${isFullscreen ? 'md:p-0' : ''}`;

  const innerContainerClassName = isSidebar
    ? 'bg-background flex flex-col w-full h-full'
    : `bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl${
      isFullscreen ? ' md:w-full md:h-full md:rounded-none' : ' md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]'
    }`;

  return (
    <>
      <style>{getEditorStyles(isDarkMode)}</style>
      <div className={outerContainerClassName}>
        <div className={innerContainerClassName}>
          <CodeEditorHeader
            file={file}
            isSidebar={isSidebar}
            isFullscreen={isFullscreen}
            isMarkdownFile={isMarkdownFile}
            markdownPreview={markdownPreview}
            saving={saving}
            saveSuccess={saveSuccess}
            onToggleMarkdownPreview={() => setMarkdownPreview((previous) => !previous)}
            onOpenSettings={() => paletteOps.openSettings('appearance')}
            onDownload={handleDownload}
            onSave={handleSave}
            onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
            onClose={onClose}
            labels={{
              showingChanges: t('header.showingChanges'),
              editMarkdown: t('actions.editMarkdown'),
              previewMarkdown: t('actions.previewMarkdown'),
              settings: t('toolbar.settings'),
              download: t('actions.download'),
              save: t('actions.save'),
              saving: t('actions.saving'),
              saved: t('actions.saved'),
              fullscreen: t('actions.fullscreen'),
              exitFullscreen: t('actions.exitFullscreen'),
              close: t('actions.close'),
            }}
          />

          {(enableAiEdit || toolbarExtra) && (
            <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5">
              {toolbarExtra}
            </div>
          )}

          {saveError && (
            <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
              {saveError}
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            <CodeEditorSurface
              content={content}
              onChange={setContent}
              markdownPreview={markdownPreview}
              isMarkdownFile={isMarkdownFile}
              isDarkMode={isDarkMode}
              fontSize={fontSize}
              showLineNumbers={showLineNumbers}
              extensions={extensions}
            />
          </div>

          <CodeEditorFooter
            content={content}
            linesLabel={t('footer.lines')}
            charactersLabel={t('footer.characters')}
            shortcutsLabel={t('footer.shortcuts')}
          />
        </div>
      </div>
    </>
  );
});

export default CodeEditor;
