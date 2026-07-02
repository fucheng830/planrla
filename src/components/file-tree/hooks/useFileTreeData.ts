import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type { FileTreeNode } from '../types/types';
import { isCacheValid, type DirCache } from '../utils/cache';

/** 项目根目录的缓存 key（dir query 省略时后端返回根）。 */
const ROOT_KEY = '';

export type UseFileTreeDataResult = {
  entriesByDir: Map<string, DirCache>;
  loadingDir: Set<string>;
  errorDir: Map<string, string>;
  /** 展开或刷新时调用：缓存有效则 no-op，否则 fetch。 */
  ensureDir: (dir: string) => void;
  /** 强制重新 fetch 某目录（忽略缓存）。 */
  refreshDir: (dir: string) => void;
  /** 手动刷新：清所有缓存 + 重新 fetch 根。 */
  refreshAll: () => void;
};

export function useFileTreeData(selectedProject: Project | null): UseFileTreeDataResult {
  const [entriesByDir, setEntriesByDir] = useState<Map<string, DirCache>>(new Map());
  const [loadingDir, setLoadingDir] = useState<Set<string>>(new Set());
  const [errorDir, setErrorDir] = useState<Map<string, string>>(new Map());
  const [refreshTick, setRefreshTick] = useState(0);

  // 按 dir 管理 AbortController，避免展开多目录时互相 abort
  const abortRefByDir = useRef<Map<string, AbortController>>(new Map());
  // 最新 entriesByDir 的 ref，供 ensureDir 同步判断（避免 effect 闭包陈旧）
  const entriesByDirRef = useRef(entriesByDir);
  useEffect(() => { entriesByDirRef.current = entriesByDir; }, [entriesByDir]);

  const projectId = selectedProject?.projectId;

  const fetchDir = useCallback(async (dir: string) => {
    if (!projectId) return;
    // abort 该 dir 的旧请求
    const prev = abortRefByDir.current.get(dir);
    if (prev) prev.abort();
    const controller = new AbortController();
    abortRefByDir.current.set(dir, controller);

    setLoadingDir((prev) => new Set(prev).add(dir));
    setErrorDir((prev) => { const n = new Map(prev); n.delete(dir); return n; });

    try {
      const response = await api.getFiles(projectId, { dir: dir === ROOT_KEY ? undefined : dir, signal: controller.signal });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`fetch dir "${dir}" failed: ${response.status} ${text}`);
      }
      const entries = (await response.json()) as FileTreeNode[];
      // 后端 maxDepth=0 不递归填 children，但保险清掉目录的 children（避免前端误用旧递归数据）
      const cleanEntries = entries.map((e) => (e.type === 'directory' ? { ...e, children: undefined } : e));
      setEntriesByDir((prev) => {
        const next = new Map(prev);
        next.set(dir, { entries: cleanEntries, fetchedAt: Date.now() });
        return next;
      });
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      const msg = error instanceof Error ? error.message : String(error);
      setErrorDir((prev) => { const n = new Map(prev); n.set(dir, msg); return n; });
    } finally {
      setLoadingDir((prev) => { const n = new Set(prev); n.delete(dir); return n; });
      abortRefByDir.current.delete(dir);
    }
  }, [projectId]);

  const ensureDir = useCallback((dir: string) => {
    if (!projectId) return;
    if (isCacheValid(entriesByDirRef.current.get(dir))) return;
    void fetchDir(dir);
  }, [projectId, fetchDir]);

  const refreshDir = useCallback((dir: string) => {
    void fetchDir(dir);
  }, [fetchDir]);

  const refreshAll = useCallback(() => {
    // 清缓存（触发 ensureDir 重 fetch）
    setEntriesByDir(new Map());
    setErrorDir(new Map());
    setRefreshTick((p) => p + 1);
  }, []);

  // 项目切换 / 手动刷新 → fetch 根
  useEffect(() => {
    if (!projectId) {
      setEntriesByDir(new Map());
      return;
    }
    void fetchDir(ROOT_KEY);
    return () => {
      // 切走时 abort 所有 in-flight
      abortRefByDir.current.forEach((c) => c.abort());
      abortRefByDir.current.clear();
    };
  }, [projectId, refreshTick, fetchDir]);

  return { entriesByDir, loadingDir, errorDir, ensureDir, refreshDir, refreshAll };
}
