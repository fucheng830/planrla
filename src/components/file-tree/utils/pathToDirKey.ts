/**
 * 绝对 node.path → 相对项目根的 dir key（正斜杠；根目录返回 ''）。
 * 必须与 flattenVisibleNodes 的 dirKey 累积（parent/name）+ useFileTreeData.fetchDir(dir) 的 dir 参数一致。
 * 假设后端返回 node.name 为 basename（不含 /），node.path 为绝对路径。
 *
 * 边界 + 大小写处理：
 *  - 兄弟前缀（/proj vs /project-x）：要求 startsWith 后紧跟分隔符或恰为根本身。
 *  - Windows 大小写（D:\proj vs d:\proj）：大小写不敏感比较根。
 */
export function pathToDirKey(absPath: string, projectRoot: string): string {
  if (!absPath || !projectRoot) return '';
  const root = projectRoot.replace(/[/\\]+$/, '');
  if (root === '') return '';
  const lowerAbs = absPath.toLowerCase();
  const lowerRoot = root.toLowerCase();
  // 恰为根本身
  if (lowerAbs === lowerRoot) return '';
  // 必须以 root + 分隔符 开头（防兄弟前缀 /proj vs /project-x）
  const next = absPath[root.length];
  if (!lowerAbs.startsWith(lowerRoot) || (next !== '/' && next !== '\\')) return '';
  return absPath
    .slice(root.length)
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');
}
