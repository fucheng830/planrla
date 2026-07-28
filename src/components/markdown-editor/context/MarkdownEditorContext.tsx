// src/components/markdown-editor/context/MarkdownEditorContext.tsx
//
// REQ-047 — Markdown 编辑器全局状态(open/close + 当前选中的项目/文件)。
// Provider 挂 AppContentInner,任何子组件可调 useMarkdownEditor().open() 打开面板。
// 镜像 KanbanContext 模式(独立 Provider,不侵入 PaletteOps)。

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface MarkdownEditorState {
  isOpen: boolean;
  // 面板打开时锚定的项目(用 fullPath + projectId 建 editor session / 拉 md 树)。
  projectId: string | null;
  projectPath: string;
  selectedPath: string | null;
  open: (projectId: string, projectPath: string, initialPath?: string | null) => void;
  close: () => void;
  selectFile: (path: string | null) => void;
}

const MarkdownEditorContext = createContext<MarkdownEditorState | null>(null);

export function MarkdownEditorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const open = useCallback(
    (pid: string, path: string, initialPath: string | null = null) => {
      setProjectId(pid);
      setProjectPath(path);
      setSelectedPath(initialPath);
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const selectFile = useCallback((path: string | null) => {
    setSelectedPath(path);
  }, []);

  const value = useMemo<MarkdownEditorState>(
    () => ({ isOpen, projectId, projectPath, selectedPath, open, close, selectFile }),
    [isOpen, projectId, projectPath, selectedPath, open, close, selectFile],
  );

  return (
    <MarkdownEditorContext.Provider value={value}>{children}</MarkdownEditorContext.Provider>
  );
}

export function useMarkdownEditor(): MarkdownEditorState {
  const ctx = useContext(MarkdownEditorContext);
  if (!ctx) {
    throw new Error('useMarkdownEditor must be used within MarkdownEditorProvider');
  }
  return ctx;
}
