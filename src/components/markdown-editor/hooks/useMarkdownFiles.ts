// src/components/markdown-editor/hooks/useMarkdownFiles.ts
//
// REQ-047 — 拉取 + 缓存项目 .md 文件树。
// 镜像 background-tasks/hooks/useBackgroundTasks.ts 的 REST + refresh 模式。

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';
import type { MdFileNode } from '../types';

export interface UseMarkdownFilesResult {
  tree: MdFileNode[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMarkdownFiles(projectId: string | null | undefined): UseMarkdownFilesResult {
  const [tree, setTree] = useState<MdFileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setTree([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMarkdownFiles(projectId);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `load failed: ${res.status}`);
      }
      const data = (await res.json()) as MdFileNode[];
      setTree(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tree, loading, error, refresh };
}
