import type { FileTreeNode } from '../types/types';

/** 目录缓存有效期 5 分钟。过期后展开/刷新重新 fetch。 */
export const CACHE_TTL_MS = 5 * 60 * 1000;

export type DirCache = {
  entries: FileTreeNode[];
  fetchedAt: number;
};

/**
 * 缓存是否仍有效（未过 TTL）。null/undefined → false。
 */
export function isCacheValid(
  cache: { entries: FileTreeNode[]; fetchedAt: number } | null | undefined,
): boolean {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}
