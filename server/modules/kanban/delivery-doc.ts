// DELIVERY.md 交付说明的截图证据解析。
//
// agent 按模板要求在 DELIVERY.md 里用 markdown 图片语法引用仓库内相对路径
// 截图(debug/ui-acceptance/*.png)。前端 Markdown 组件只把「绝对路径/盘符」
// 映射到 /api/providers/local-image 代理,相对路径渲染不出来——所以由后端在
// 返回 delivery-doc 时把「真实存在于 worktree」的相对路径改写为绝对路径。
// 只重写 existsSync 通过的引用:不存在的原样保留,「声明了但文件缺失」本身
// 就是给验收人看的信号。

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/** markdown 图片:![alt](src) — src 可带 "title",可被 <> 包裹。 */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 外部引用与已解析好的绝对路径都不改写(前端 Markdown 已能处理绝对路径)。 */
function isExternalOrAbsolute(p: string): boolean {
  return /^(https?:|file:|data:)/i.test(p) || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
}

/**
 * 把 DELIVERY.md 中真实存在的相对路径图片改写为绝对路径(正斜杠归一)。
 * worktreePath 缺失时原文返回。防 `..` 跳出 worktree:解析后必须仍在其内。
 */
export function resolveDeliveryDocImages(content: string, worktreePath: string | null | undefined): string {
  if (!worktreePath || !content) return content;
  const rootAbs = resolve(worktreePath);
  return content.replace(MD_IMAGE_RE, (full, alt: string, raw: string) => {
    const m = raw.match(/^\s*<?([^>\s]+)>?(?:\s+"[^"]*")?\s*$/);
    if (!m) return full;
    const p = m[1];
    if (isExternalOrAbsolute(p)) return full;
    const abs = resolve(rootAbs, ...p.split(/[\\/]+/).filter((seg) => seg !== '.'));
    // containment:`..` 跳出 worktree 的引用一律不改写(防越过信任边界)。
    if (relative(rootAbs, abs).startsWith('..')) return full;
    if (!existsSync(abs)) return full;
    return `![${alt}](${abs.replace(/\\/g, '/')})`;
  });
}
