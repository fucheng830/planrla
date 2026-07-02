import { useMemo, useState } from 'react';
import type { FileTreeNode } from '../types/types';
import type { DirCache } from '../utils/cache';

type UseFileTreeSearchArgs = {
  /**
   * 增量目录缓存（来自 useFileTreeData）。搜索范围 = 所有已缓存目录的 entries
   * 扁平化后去重，不受 expandedDirs 限制（含折叠但已 fetch 的目录）。
   * 未加载的目录不在搜索范围（spec 接受此简化）。
   */
  entriesByDir: Map<string, DirCache>;
};

type UseFileTreeSearchResult = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /** 命中节点（扁平，搜索所有已缓存目录）。无查询或无命中时为 []。 */
  filteredNodes: FileTreeNode[];
  /** 是否处于搜索态（query 非空）。调用方据此切换“扁平搜索结果”与“树形可见行”。 */
  isSearching: boolean;
};

/**
 * 增量模型下的文件树搜索。
 *
 * 与旧实现差异：旧版接受递归 `files: FileTreeNode[]` 并调用 `filterFileTree`
 * 做树形过滤 + `expandDirectories` 自动展开祖先。FT10 起文件树为增量加载
 * （目录按需 fetch，缓存在 entriesByDir），故搜索改为：
 *   1. 收集所有已缓存目录的 entries（含未展开但已 fetch 的）；
 *   2. 按 path 去重（同一目录可能在多路径下被缓存命中）；
 *   3. 按 name 子串（大小写不敏感）过滤；
 *   4. 调用方在 isSearching 时以 level 0 扁平渲染 filteredNodes。
 *
 * 自动展开定位（旧 expandDirectories 行为）在增量模型下不再适用——搜索结果
 * 作为独立扁平列表展示，不回嵌到原树结构。如需“定位回树”属更复杂特性，留后续。
 */
export function useFileTreeSearch({
  entriesByDir,
}: UseFileTreeSearchArgs): UseFileTreeSearchResult {
  const [searchQuery, setSearchQuery] = useState('');

  // 收集所有已缓存目录的 entries，按 path 去重。
  const allCachedNodes = useMemo(() => {
    const seen = new Set<string>();
    const all: FileTreeNode[] = [];
    entriesByDir.forEach((cache) => {
      for (const entry of cache.entries) {
        if (entry.path && !seen.has(entry.path)) {
          seen.add(entry.path);
          all.push(entry);
        }
      }
    });
    return all;
  }, [entriesByDir]);

  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allCachedNodes.filter((n) => n.name.toLowerCase().includes(q));
  }, [allCachedNodes, searchQuery]);

  const isSearching = searchQuery.trim().length > 0;

  return {
    searchQuery,
    setSearchQuery,
    filteredNodes,
    isSearching,
  };
}
