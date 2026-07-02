/**
 * 绝对 node.path → 相对项目根的 dir key（正斜杠；根目录返回 ''）。
 * 必须与 flattenVisibleNodes 的 dirKey 累积（parent/name）+ useFileTreeData.fetchDir(dir) 的 dir 参数一致。
 * 假设后端返回 node.name 为 basename（不含 /），node.path 为绝对路径。
 */
export function pathToDirKey(absPath: string, projectRoot: string): string {
  if (!absPath.startsWith(projectRoot)) return '';
  return absPath
    .slice(projectRoot.length)
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');
}
