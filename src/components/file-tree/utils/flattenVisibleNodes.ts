import type { FileTreeNode } from '../types/types';
import { isCacheValid, type DirCache } from './cache';

/** 项目根目录的缓存 key（与 useFileTreeData 一致）。 */
export const ROOT_KEY = '';

export type VisibleNode = {
  node: FileTreeNode;
  level: number;
};

/**
 * 把增量加载的目录缓存扁平化为当前可见节点列表（DFS）。
 * 展开的目录（expandedDirs 含其 path）且缓存有效 → 递归扁平化其 entries。
 * 展开但未加载/缓存过期 → 只渲染目录本身（不递归；渲染层显示 loading 占位）。
 *
 * dirKey 累积：从 ROOT_KEY 开始，每层 `parentDirKey === ROOT_KEY ? node.name : parentDirKey + '/' + node.name`。
 * 这与 useFileTreeData.fetchDir(dir) 的 dir 参数（相对项目根，正斜杠）一致。
 */
export function flattenVisibleNodes(
  entriesByDir: Map<string, DirCache>,
  expandedDirs: Set<string>,
  _projectRootPath: string,
): VisibleNode[] {
  const result: VisibleNode[] = [];
  const rootCache = entriesByDir.get(ROOT_KEY);
  if (!rootCache || !isCacheValid(rootCache)) return result;

  const walk = (entries: FileTreeNode[], level: number, parentDirKey: string) => {
    for (const node of entries) {
      result.push({ node, level });
      if (node.type !== 'directory') continue;
      if (!expandedDirs.has(node.path)) continue;

      const dirKey = parentDirKey === ROOT_KEY ? node.name : `${parentDirKey}/${node.name}`;
      const childCache = entriesByDir.get(dirKey);
      if (childCache && isCacheValid(childCache)) {
        walk(childCache.entries, level + 1, dirKey);
      }
    }
  };

  walk(rootCache.entries, 0, ROOT_KEY);
  return result;
}
