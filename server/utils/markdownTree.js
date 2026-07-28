// server/utils/markdownTree.js
//
// REQ-047 — 递归扫描项目内 .md/.markdown/.txt 文件树,给侧边栏 Markdown
// 编辑面板浏览用。纯函数模块,便于单元测试(白名单/深度/排除目录/大小上限)。
//
// 安全要点(详见 docs/superpowers/specs/2026-07-28-req047-md-editor-design.md §4):
//   - 白名单扩展名(.md/.markdown/.txt),拒绝读源码/配置
//   - 递归深度 ≤10,防超深嵌套 DOS
//   - 单文件 >1MB 跳过,防读大日志
//   - 排除噪音目录(node_modules/.git/dist/.claude/worktrees 等)
//   - 调用方负责 realpath 越界校验(本模块假设 currentDir 已在 root 内)

import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';

export const MD_ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
export const MD_EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out',
    'coverage', '.cache', '.worktree', '.turbo', '.vercel',
]);
export const MD_MAX_DEPTH = 10;
export const MD_MAX_FILE_SIZE = 1024 * 1024; // 1MB

/**
 * 单个文件/目录树节点。前端 MarkdownTree.tsx 直接消费。
 * @typedef {Object} MdFileNode
 * @property {string} name  - 目录或文件名
 * @property {string} path  - 项目相对路径(/ 分隔,可直接喂 /file route 的 filePath)
 * @property {'file'|'dir'} type
 * @property {MdFileNode[]=} children - 仅 dir 有
 */

async function safeReaddir(dir) {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function safeStat(filePath) {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

function toPosixRel(root, fullPath) {
    return relative(root, fullPath).split(sep).join('/');
}

/**
 * 递归扫描 markdown 文件树。
 *
 * @param {string} realRoot    - 项目根的 realpath(绝对)
 * @param {string} currentDir  - 当前扫描目录(绝对,调用方保证在 realRoot 内)
 * @param {number} depth       - 当前深度(项目根 = 0)
 * @returns {Promise<MdFileNode[]>}
 */
export async function scanMarkdownTree(realRoot, currentDir, depth) {
    if (depth > MD_MAX_DEPTH) return [];

    const entries = await safeReaddir(currentDir);
    const result = [];

    for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
            // 排除噪音目录(node_modules / .git / dist / build ...)。
            if (MD_EXCLUDED_DIRS.has(entry.name)) continue;
            // .claude 目录:若含 worktrees 子目录则整个跳过(防 worktree 污染主仓)。
            if (entry.name === '.claude') {
                const sub = await safeReaddir(fullPath);
                const dirents = await Promise.all(
                    sub.filter((d) => d.isDirectory()).map((d) => d.name),
                );
                if (dirents.includes('worktrees')) continue;
            }
            const children = await scanMarkdownTree(realRoot, fullPath, depth + 1);
            // 空目录(无 md 子孙)不返回,减少噪音。
            if (children.length > 0) {
                result.push({
                    name: entry.name,
                    path: toPosixRel(realRoot, fullPath),
                    type: 'dir',
                    children,
                });
            }
            continue;
        }

        if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (!MD_ALLOWED_EXTENSIONS.has(ext)) continue;
            const s = await safeStat(fullPath);
            if (!s || s.size > MD_MAX_FILE_SIZE) continue;
            result.push({
                name: entry.name,
                path: toPosixRel(realRoot, fullPath),
                type: 'file',
            });
        }
    }

    // 目录置顶,同类按名排序。
    result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return result;
}

