// src/components/markdown-editor/view/MarkdownEditorPanel.tsx
//
// REQ-047 — 侧边栏 Markdown 编辑面板(portal)。
// 镜像 BackgroundTasksPanel 的 portal 模式:全屏遮罩 + 居中卡片。
// 左侧 .md 文件树,右侧 CodeEditor(含 AI 选段改)。
//
// AI 选段改集成:
//   - useAiSelectionEdit 提供 slot(选区/silent send/diff 构造/接受拒绝)
//   - CodeEditor enableAiEdit + aiEditSlot + retainContentOnDiffClear
//   - AiEditControls 通过 toolbarExtra 渲染在编辑器顶部
//   - 接受:slot.accept() → onClearDiff(清 file.diffInfo,CodeEditor 保留 content)
//   - 拒绝:slot.reject() → onRevertTo(oldFull) 还原 + onClearDiff

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';

import { Button } from '@/shared/view/ui';
import CodeEditor, { type CodeEditorHandle, type AiEditSlot } from '../../code-editor/view/CodeEditor';
import type { CodeEditorDiffInfo, CodeEditorFile } from '../../code-editor/types/types';
import { useMarkdownEditor } from '../context/MarkdownEditorContext';
import { useMarkdownFiles } from '../hooks/useMarkdownFiles';
import { useAiSelectionEdit } from '../hooks/useAiSelectionEdit';
import { MarkdownTree } from './MarkdownTree';
import { AiEditControls } from './AiEditControls';

// 默认 provider(AI 选段改建 session 用)。与 sidebar 默认一致(claude)。
const DEFAULT_PROVIDER = 'claude';

export function MarkdownEditorPanel() {
  const { t } = useTranslation('markdownEditor');
  const { isOpen, close, projectId, projectPath, selectedPath, selectFile } = useMarkdownEditor();
  const { tree, loading, error, refresh } = useMarkdownFiles(isOpen ? projectId : null);

  const editorRef = useRef<CodeEditorHandle>(null);

  // 当前打开的文件对象(含 diffInfo,受控)。selectedPath 变化时重建。
  const [file, setFile] = useState<CodeEditorFile | null>(null);
  // 用 key 在 selectedPath 变化时强制 CodeEditor remount(清掉上一个文件的状态)。
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // selectedPath 变化时更新 file 对象。
  useEffect(() => {
    if (!isOpen || !selectedPath) {
      setFile(null);
      return;
    }
    const fileName = selectedPath.split('/').pop() || selectedPath;
    setFile({
      name: fileName,
      path: selectedPath,
      projectId: projectId ?? undefined,
      diffInfo: null,
    });
    setEditorKey((k) => k + 1);
  }, [isOpen, selectedPath, projectId]);

  // AI diff 控制:setDiffInfo(应用)/ clearDiff(接受/拒绝后)。
  const applyDiff = (diff: { old_string: string; new_string: string; aiEdit: true }) => {
    setFile((prev) => (prev ? { ...prev, diffInfo: diff as unknown as CodeEditorDiffInfo } : prev));
  };
  const clearDiff = () => {
    setFile((prev) => (prev ? { ...prev, diffInfo: null } : prev));
  };

  const aiEdit = useAiSelectionEdit({
    projectId,
    projectPath,
    provider: DEFAULT_PROVIDER,
    relativePath: selectedPath ?? '',
    getContent: () => editorRef.current?.getContent() ?? '',
    onApplyDiff: applyDiff,
    onClearDiff: clearDiff,
    onRevertTo: (content) => editorRef.current?.setContent(content),
  });

  // 把 hook 返回值映射成 AiEditSlot(类型对齐 CodeEditor prop)。
  const aiSlot: AiEditSlot = useMemo(() => ({
    onSelectionChange: aiEdit.onSelectionChange,
    trigger: aiEdit.trigger,
    submitPrompt: aiEdit.submitPrompt,
    cancelInstruction: aiEdit.cancelInstruction,
    cancelRun: aiEdit.cancelRun,
    accept: aiEdit.accept,
    reject: aiEdit.reject,
    status: aiEdit.status,
    hasSelection: aiEdit.hasSelection,
    hasAiDiff: aiEdit.hasAiDiff,
    awaitingInstruction: aiEdit.awaitingInstruction,
    message: aiEdit.message,
  }), [aiEdit]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="flex h-[88vh] w-full max-w-6xl flex-col rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{t('title')}</h2>
            {selectedPath && (
              <span className="truncate text-xs text-muted-foreground">{selectedPath}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void refresh()} title={t('refresh')}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={close} aria-label={t('close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body: 左树 + 右编辑器 */}
        <div className="flex min-h-0 flex-1">
          {/* 文件树 */}
          <div className="flex w-56 flex-shrink-0 flex-col border-r border-border">
            <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('files')}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">{t('loading')}</div>
              ) : error ? (
                <div className="px-2 py-4 text-xs text-destructive">{t('loadError')}: {error}</div>
              ) : tree.length === 0 ? (
                <div className="px-2 py-4 text-xs text-muted-foreground">{t('empty')}</div>
              ) : (
                <MarkdownTree nodes={tree} selectedPath={selectedPath} onSelect={selectFile} />
              )}
            </div>
          </div>

          {/* 编辑器 */}
          <div className="flex min-w-0 flex-1 flex-col">
            {file ? (
              <CodeEditor
                key={editorKey}
                ref={editorRef}
                file={file}
                onClose={close}
                projectPath={projectId ?? undefined}
                isSidebar
                enableAiEdit
                aiEditSlot={aiSlot}
                retainContentOnDiffClear
                toolbarExtra={<AiEditControls slot={aiSlot} />}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('empty')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
