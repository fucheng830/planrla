# 文件树增量加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文件树从 depth-10 全扫+全渲改为按目录懒加载 + react-window 虚拟化 + 5min 缓存，解决开大项目/展开大目录/切回重扫三大痛点。

**Architecture:** 后端 `/files` 路由复用现有 `getFileTree(path, maxDepth=0)` 做严格单层扫描（`currentDepth < maxDepth` 即 `0<0=false`，不递归，目录项无 children；加 `?dir=` + 路径穿越校验 + scan 耗时日志）；前端 `useFileTreeData` 改 `Map<dir, {entries, fetchedAt}>` 懒加载 + TTL 缓存；渲染层用纯函数 `flattenVisibleNodes` 扁平化可见树 + `react-window` `FixedSizeList` 虚拟化；`FileTreeNode` 从递归组件改为单行单元。

**Tech Stack:** Express（后端）、React + `react-window`（前端虚拟化）、TypeScript、`node:test`（纯函数测试，`npx tsx --test`）。

**Spec:** `docs/superpowers/specs/2026-07-02-file-tree-incremental-design.md`

**Plan 阶段相对 spec 的两点简化（YAGNI）：**
1. **不新建 `getFileTreeShallow`**：`getFileTree` 已支持 `maxDepth` 参数（`/browse-filesystem` 已用 `maxDepth=1`），`/files` 路由调 `getFileTree(targetPath, 0, 0, true)` 做严格单层（`0<0=false` 不递归，目录项无 children）。少一个新函数 + 少一份测试。
2. **不带 `childrenCount`**：每个目录多一次 `readdir` 计数会在含大量目录的项目里抵消增量收益。改为：目录始终显示展开箭头，空目录展开后显示空状态。前端不需要预知子项数。

---

## 文件结构

**Create:**
- `src/components/file-tree/utils/cache.ts` — `isCacheValid(fetchedAt)` 纯函数 + `CACHE_TTL_MS` 常量
- `src/components/file-tree/utils/cache.test.ts` — node:test
- `src/components/file-tree/utils/flattenVisibleNodes.ts` — 可见节点扁平化纯函数
- `src/components/file-tree/utils/flattenVisibleNodes.test.ts` — node:test

**Modify:**
- `server/index.js` — `/files` 路由（L653 附近）改 `?dir=` 单层 + 路径穿越校验 + scan 耗时日志
- `src/utils/api.js` — `getFiles(projectId, {dir, signal})` 加 dir 参数
- `src/components/file-tree/hooks/useFileTreeData.ts` — 重构为 entriesByDir + fetchDir + 缓存
- `src/components/file-tree/view/FileTreeNode.tsx` — 去递归，改单行单元 + 展开触发懒 fetch
- `src/components/file-tree/view/FileTreeList.tsx` — 递归 `.map` 改 react-window `FixedSizeList`
- `src/components/file-tree/view/FileTreeBody.tsx` 或 `FileTree.tsx` — 编排：接新数据 hook + flattenVisibleNodes
- `src/components/file-tree/hooks/useFileTreeSearch.ts` — 适配增量模型（搜已缓存目录）
- `package.json` — 加 `react-window` + `@types/react-window`

**环境约束:**
- 项目无 vitest/jest；纯函数用 `node:test`（`npx tsx --test <file>`），import 用 extensionless（项目 tsconfig `moduleResolution: "Bundler"`，禁 `.ts` 扩展）
- eslint `no-empty` 要求 catch 块加注释
- commitlint subject 不允许 PascalCase 词；subject 首词小写
- 提交前确认根目录无 `nul` 文件

---

## Task 1: 后端 `/files` 路由改增量单层

**Files:**
- Modify: `server/index.js`（`/api/projects/:projectId/files` 路由，约 L653-673）

- [ ] **Step 1: 读现有路由，确认解析逻辑**

```bash
cd D:/workspace/projects/ai/apps/planrla
sed -n '653,680p' server/index.js
```
确认路由如何从 `projectId` 解析到 `actualPath`（DB 查询），以及现有 `getFileTree(actualPath, 10, 0, true)` 调用。复用 projectId → actualPath 解析，只改扫描调用 + 加 dir 参数。

- [ ] **Step 2: 改路由为增量单层 + 路径穿越校验 + 性能日志**

把路由处理改为（保留现有 projectId → actualPath 解析的前置代码，从调用 getFileTree 处替换到 res.json）：

```js
// dir query：省略 / '.' / '' = 项目根；否则相对项目根的子目录
const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
const targetPath = dir === '' || dir === '.'
  ? actualPath
  : path.resolve(actualPath, dir);

// 路径穿越校验：targetPath 必须在 actualPath 内（含本身）
const relative = path.relative(actualPath, targetPath);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  return res.status(400).json({ error: 'Invalid directory path' });
}

const t0 = performance.now();
try {
  // 严格单层扫描（maxDepth=0）：currentDepth < maxDepth 即 0<0=false，不递归，目录项无 children
  const files = await getFileTree(targetPath, 0, 0, true);
  console.log(`[files] scan dir="${dir || '.'}" took ${Math.round(performance.now() - t0)}ms (${files.length} entries)`);
  res.json(files);
} catch (error) {
  console.error('Error fetching file tree:', error);
  res.status(500).json({ error: 'Failed to fetch file tree' });
}
```

> 注：`performance` 在 Node 18+ 是全局可用（`performance.now()`），server/index.js 顶层无需 import。如已 import 别的 perf 模块则沿用。

- [ ] **Step 3: build:server + 启动验证**

```bash
npm run build:server
npm run server &
sleep 5
# login token（沿用项目默认账号，或现有 token）
TOKEN=$(curl -sS -X POST http://127.0.0.1:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"planrla","password":"planrla"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
# 顶层（无 dir）
curl -sS "http://127.0.0.1:3001/api/projects/<some-project-id>/files" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('entries:',a.length,'first:',a[0]?.name,'hasChildren:',!!a[0]?.children)})"
# 子目录（dir=src）
curl -sS "http://127.0.0.1:3001/api/projects/<some-project-id>/files?dir=src" -H "Authorization: Bearer $TOKEN" | head -c 200
# 路径穿越拒绝
curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3001/api/projects/<some-project-id>/files?dir=../etc" -H "Authorization: Bearer $TOKEN"
kill %1
```
Expected: 顶层返回单层 entries（目录项无 children，因 maxDepth=0 不递归）；`dir=src` 返回 src 下的单层；`dir=../etc` 返回 400；server 日志见 `[files] scan ... took Nms`。

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(files): incremental single-level scan with dir query"
```

---

## Task 2: 前端 `api.getFiles` 加 dir 参数

**Files:**
- Modify: `src/utils/api.js`（`getFiles` 约 L150）

- [ ] **Step 1: 读现有 getFiles**

```bash
sed -n '148,165p' src/utils/api.js
```

- [ ] **Step 2: 加 dir 到 URL + options**

把 `getFiles` 改为（保留现有 `options = {}` 解构，加 `dir`）：

```js
  getFiles: (projectId, options = {}) => {
    const params = new URLSearchParams();
    if (options.dir) params.set('dir', options.dir);
    const query = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch(`/api/projects/${projectId}/files${query}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  },
```

> 保留现有返回值（Response 对象，调用方 `.json()`）。`signal` 透传保留。

- [ ] **Step 3: typecheck + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
git add src/utils/api.js
git commit -m "feat(files): api.getFiles accepts dir parameter"
```

---

## Task 3: 缓存 TTL 纯函数 + 测试

**Files:**
- Create: `src/components/file-tree/utils/cache.ts`
- Test: `src/components/file-tree/utils/cache.test.ts`

- [ ] **Step 1: 写失败测试**

`src/components/file-tree/utils/cache.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_TTL_MS, isCacheValid } from './cache';

test('CACHE_TTL_MS is 5 minutes', () => {
  assert.equal(CACHE_TTL_MS, 5 * 60 * 1000);
});

test('isCacheValid: null/undefined → false', () => {
  assert.equal(isCacheValid(null), false);
  assert.equal(isCacheValid(undefined), false);
});

test('isCacheValid: 刚 fetched → true', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() }), true);
});

test('isCacheValid: TTL 内 → true', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() - CACHE_TTL_MS + 1000 }), true);
});

test('isCacheValid: TTL 过期 → false', () => {
  assert.equal(isCacheValid({ entries: [], fetchedAt: Date.now() - CACHE_TTL_MS - 1 }), false);
});
```

- [ ] **Step 2: 跑确认失败**

```bash
npx tsx --test src/components/file-tree/utils/cache.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/components/file-tree/utils/cache.ts`：

```ts
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
export function isCacheValid(cache: { entries: FileTreeNode[]; fetchedAt: number } | null | undefined): boolean {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}
```

- [ ] **Step 4: 跑确认 4 tests PASS**

```bash
npx tsx --test src/components/file-tree/utils/cache.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/file-tree/utils/cache.ts src/components/file-tree/utils/cache.test.ts
git commit -m "feat(files): dir cache ttl pure fns"
```

---

## Task 4: `useFileTreeData` 重构（懒加载 + 缓存）

**Files:**
- Modify: `src/components/file-tree/hooks/useFileTreeData.ts`

- [ ] **Step 1: 整体重写为增量模型**

把 `src/components/file-tree/hooks/useFileTreeData.ts` 整体替换为：

```ts
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
      // 后端返回的 entries：目录项可能仍带 children（旧 maxDepth 行为）—— 确保目录无 children（增量模型不预加载）
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
```

> 注：`cleanEntries` 把目录的 `children` 清 undefined（后端 maxDepth=0 不递归、目录项本就无 children，但保险清掉，避免前端误用旧递归数据）。

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useFileTreeData" || echo "useFileTreeData 无类型错误"
```
> 此时 FileTreeBody 等消费者还在用旧的 `{ files, loading, refreshFiles }` 返回值，typecheck 会报错（FileTreeBody 期望 files）。**这些错误在 Task 9（编排适配）修复**，本步只确认 useFileTreeData 自身类型正确（grep 过滤）。

- [ ] **Step 3: Commit**

```bash
git add src/components/file-tree/hooks/useFileTreeData.ts
git commit -m "feat(files): useFileTreeData incremental lazy load + cache"
```

---

## Task 5: `flattenVisibleNodes` 纯函数 + 测试

**Files:**
- Create: `src/components/file-tree/utils/flattenVisibleNodes.ts`
- Test: `src/components/file-tree/utils/flattenVisibleNodes.test.ts`

- [ ] **Step 1: 写失败测试**

`src/components/file-tree/utils/flattenVisibleNodes.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenVisibleNodes, ROOT_KEY } from './flattenVisibleNodes';
import type { FileTreeNode } from '../types/types';
import { isCacheValid } from './cache';

const node = (name: string, path: string, type: 'file' | 'directory'): FileTreeNode => ({ name, path, type });

test('空 entriesByDir → 空列表', () => {
  assert.deepEqual(flattenVisibleNodes(new Map(), new Set()), []);
});

test('只有根 → 顶层 entries，level 0', () => {
  const entries: FileTreeNode[] = [node('a', '/p/a', 'file'), node('b', '/p/b', 'file')];
  const cache = new Map([[ROOT_KEY, { entries, fetchedAt: Date.now() }]]);
  const result = flattenVisibleNodes(cache, new Set());
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.node.name), ['a', 'b']);
  assert.deepEqual(result.map((r) => r.level), [0, 0]);
});

test('展开目录 → 递归扁平化子项，level 递增', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory'), node('readme', '/p/readme', 'file')];
  const srcChildren: FileTreeNode[] = [node('index', '/p/src/index', 'file'), node('utils', '/p/src/utils', 'directory')];
  const cache = new Map([
    [ROOT_KEY, { entries: root, fetchedAt: Date.now() }],
    ['src', { entries: srcChildren, fetchedAt: Date.now() }],
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']));
  assert.deepEqual(result.map((r) => r.node.name), ['src', 'index', 'utils', 'readme']);
  assert.deepEqual(result.map((r) => r.level), [0, 1, 1, 0]);
});

test('目录展开但未加载（无缓存）→ 只渲染目录本身，不递归', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory')];
  const cache = new Map([[ROOT_KEY, { entries: root, fetchedAt: Date.now() }]]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']));
  assert.deepEqual(result.map((r) => r.node.name), ['src']); // src 展开但子未加载，不递归
});

test('缓存过期的展开目录 → 不递归（视为未加载）', () => {
  const root: FileTreeNode[] = [node('src', '/p/src', 'directory')];
  const stale = Date.now() - 10 * 60 * 1000; // 过期
  const cache = new Map([
    [ROOT_KEY, { entries: root, fetchedAt: Date.now() }],
    ['src', { entries: [node('x', '/p/src/x', 'file')], fetchedAt: stale }],
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/src']));
  assert.deepEqual(result.map((r) => r.node.name), ['src']);
});

test('嵌套展开 → 多级 level', () => {
  const root: FileTreeNode[] = [node('a', '/p/a', 'directory')];
  const aChildren: FileTreeNode[] = [node('b', '/p/a/b', 'directory')];
  const bChildren: FileTreeNode[] = [node('c', '/p/a/b/c', 'file')];
  const cache = new Map([
    [ROOT_KEY, { entries: root, fetchedAt: Date.now() }],
    ['a', { entries: aChildren, fetchedAt: Date.now() }],
    ['a/b', { entries: bChildren, fetchedAt: Date.now() }], // 注意 dir key 是相对路径
  ]);
  const result = flattenVisibleNodes(cache, new Set(['/p/a', '/p/a/b']));
  assert.deepEqual(result.map((r) => r.node.name), ['a', 'b', 'c']);
  assert.deepEqual(result.map((r) => r.level), [0, 1, 2]);
});
```

> ⚠️ 注意：`expandedDirs` 用绝对 path（`/p/src`），但 `entriesByDir` 的 key 用相对 dir（`src`、`a/b`）。`flattenVisibleNodes` 需要把 node 的绝对 path 转成相对 dir key 去 lookup entriesByDir。这要求知道项目根。简化：`flattenVisibleNodes` 接收 `projectRootPath` 参数，算 `relative(root, node.path)` 作为 dir key。

- [ ] **Step 2: 跑确认失败**

```bash
npx tsx --test src/components/file-tree/utils/flattenVisibleNodes.test.ts
```

- [ ] **Step 3: 实现**

`src/components/file-tree/utils/flattenVisibleNodes.ts`：

```ts
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
 * @param entriesByDir 目录缓存（key=相对项目根的 dir，ROOT_KEY=根）
 * @param expandedDirs 展开的目录绝对 path 集合
 * @param projectRootPath 项目根绝对路径（用于 node.path → 相对 dir key 转换）
 */
export function flattenVisibleNodes(
  entriesByDir: Map<string, DirCache>,
  expandedDirs: Set<string>,
  projectRootPath: string,
): VisibleNode[] {
  const result: VisibleNode[] = [];
  const rootCache = entriesByDir.get(ROOT_KEY);
  if (!isCacheValid(rootCache)) return result;

  const walk = (entries: FileTreeNode[], level: number, parentDirKey: string) => {
    for (const node of entries) {
      result.push({ node, level });
      if (node.type !== 'directory') continue;
      if (!expandedDirs.has(node.path)) continue;

      // node.path 是绝对路径；转成相对项目根的 dir key
      // parentDirKey === ROOT_KEY 时，dirKey = node.name；否则 parentDirKey + '/' + node.name
      const dirKey = parentDirKey === ROOT_KEY ? node.name : `${parentDirKey}/${node.name}`;
      const childCache = entriesByDir.get(dirKey);
      if (isCacheValid(childCache)) {
        walk(childCache.entries, level + 1, dirKey);
      }
      // 缓存无效/未加载 → 不递归（渲染层基于 expandedDirs.has + !cache 显示 loading 行）
    }
  };

  walk(rootCache.entries, 0, ROOT_KEY);
  return result;
}
```

> ⚠️ 测试里 `projectRootPath` 参数：把测试的 `/p` 作为根。更新测试调用：
> ```ts
> flattenVisibleNodes(cache, new Set(['/p/src']), '/p')
> ```
> 测试里 node.path 是 `/p/src`，parentDirKey 从 ROOT_KEY 开始，dirKey = `src`（node.name）→ 匹配 cache key `src`。✓ 嵌套 `a/b` 同理。

- [ ] **Step 4: 修正测试加 projectRootPath 参数后跑确认 6 tests PASS**

测试调用都加 `'/p'` 第三参数。跑：
```bash
npx tsx --test src/components/file-tree/utils/flattenVisibleNodes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/file-tree/utils/flattenVisibleNodes.ts src/components/file-tree/utils/flattenVisibleNodes.test.ts
git commit -m "feat(files): flatten visible nodes pure fn"
```

---

## Task 6: 装 react-window 依赖

**Files:**
- Modify: `package.json` + `package-lock.json`

- [ ] **Step 1: 装 react-window + 类型**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm install react-window
npm install -D @types/react-window
```

- [ ] **Step 2: 确认装上 + typecheck**

```bash
node -e "console.log(require('react-window/package.json').version)"
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(files): add react-window for virtualization"
```

---

## Task 7: `FileTreeNode` 改单行单元（去递归）

**Files:**
- Modify: `src/components/file-tree/view/FileTreeNode.tsx`

- [ ] **Step 1: 去掉递归 children（L202-237），加展开触发懒 fetch**

在 `src/components/file-tree/view/FileTreeNode.tsx`：

a) Props 类型加 `onToggleDir`（展开触发懒 fetch）+ `isLoading`（该目录 loading）+ `errorMessage`（该目录错误）：

```ts
type FileTreeNodeProps = {
  // ...现有 props 保留...
  onToggleDir?: (path: string) => void;   // 展开箭头点击 → toggle + ensureDir
  isLoading?: boolean;                      // 该目录正在 fetch 子项
  errorMessage?: string;                    // 该目录 fetch 失败
};
```

b) 函数签名加解构 `onToggleDir, isLoading, errorMessage`。

c) `TreeItemIcon` 里的 `ChevronRight` 包一个可点击 span（仅目录），点击触发 `onToggleDir`：

```tsx
{item.type === 'directory' ? (
  <span
    className="flex flex-shrink-0 items-center gap-0.5 cursor-pointer"
    onClick={(e) => {
      e.stopPropagation();
      onToggleDir?.(item.path);
    }}
  >
    <ChevronRight
      className={cn(
        'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
        isOpen && 'rotate-90',
        isLoading && 'animate-pulse',
      )}
    />
    {isOpen ? (
      <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-500" />
    ) : (
      <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    )}
    {errorMessage && <span className="text-[10px] text-red-500" title={errorMessage}>!</span>}
  </span>
) : (
  <span className="ml-[18px] flex flex-shrink-0 items-center">{renderFileIcon(item.name)}</span>
)}
```

d) **删除** L202-237 的 `{isDirectory && isOpen && hasChildren && (...)}` 递归块（整个 `<div className="relative">...</div>`）—— 单行单元不再递归 children。虚拟化层负责扁平渲染。

e) 同时删 `hasChildren` 变量（不再需要，单行单元不判断 children）。

> 注：保留 `isOpen`（仍用于图标 + 行样式 border-l）。`isLoading`/`errorMessage` 由虚拟化层按 node.path 查 loadingDir/errorDir 传入。

- [ ] **Step 2: typecheck（可能因未传新 props 报错，Task 8/9 修复）**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FileTreeNode" | head
```
> 新 props 可选（`?`），不会因未传报错。旧 `children` 递归删了，FileTreeNode 不再用 children。OK。

- [ ] **Step 3: Commit**

```bash
git add src/components/file-tree/view/FileTreeNode.tsx
git commit -m "refactor(files): file tree node single-row cell no recursion"
```

> 注：commitlint subject-case 拒绝 PascalCase —— "file tree node" 小写连字符。

---

## Task 8: `FileTreeList` 改 react-window 虚拟化

**Files:**
- Modify: `src/components/file-tree/view/FileTreeList.tsx`

- [ ] **Step 1: 改为 react-window FixedSizeList 渲染扁平列表**

把 `src/components/file-tree/view/FileTreeList.tsx` 整体替换为：

```tsx
import type { ReactNode, RefObject } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import FileTreeNode from './FileTreeNode';

const ROW_HEIGHT_BY_MODE: Record<FileTreeViewMode, number> = {
  simple: 28,
  compact: 24,
  detailed: 40,
};

type VisibleRow = {
  node: FileTreeNodeType;
  level: number;
};

type FileTreeListProps = {
  visibleRows: VisibleRow[];
  viewMode: FileTreeViewMode;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  onToggleDir?: (path: string) => void;
  isLoadingDir: (path: string) => boolean;
  errorOfDir: (path: string) => string | undefined;
  // Rename state
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
  // 列表高度（外层容器高度，虚拟化需要）
  height: number;
};

export default function FileTreeList(props: FileTreeListProps) {
  const {
    visibleRows, viewMode, expandedDirs, onItemClick, renderFileIcon,
    formatFileSize, formatRelativeTime, onRename, onDelete, onNewFile, onNewFolder,
    onCopyPath, onDownload, onRefresh, onToggleDir, isLoadingDir, errorOfDir,
    renamingItem, renameValue, setRenameValue, handleConfirmRename, handleCancelRename,
    renameInputRef, operationLoading, height,
  } = props;

  const rowHeight = ROW_HEIGHT_BY_MODE[viewMode];

  const renderRow = ({ index, style }: ListChildComponentProps) => {
    const { node, level } = visibleRows[index];
    return (
      <div style={style}>
        <FileTreeNode
          key={node.path}
          item={node}
          level={level}
          viewMode={viewMode}
          expandedDirs={expandedDirs}
          onItemClick={onItemClick}
          renderFileIcon={renderFileIcon}
          formatFileSize={formatFileSize}
          formatRelativeTime={formatRelativeTime}
          onRename={onRename}
          onDelete={onDelete}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onDownload={onDownload}
          onRefresh={onRefresh}
          onToggleDir={onToggleDir}
          isLoading={isLoadingDir(node.path)}
          errorMessage={errorOfDir(node.path)}
          renamingItem={renamingItem}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          handleConfirmRename={handleConfirmRename}
          handleCancelRename={handleCancelRename}
          renameInputRef={renameInputRef}
          operationLoading={operationLoading}
        />
      </div>
    );
  };

  return (
    <List
      height={height}
      itemCount={visibleRows.length}
      itemSize={rowHeight}
      width="100%"
      overscanCount={10}
    >
      {renderRow}
    </List>
  );
}
```

> 注：`FixedSizeList` 要求固定 `height`（外层容器 px 高度）。由 Task 9 的编排层传入（容器用 flex-1 + ref 测高，或固定高）。简化先用外层传入 `height` prop。

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "FileTreeList|FixedSize" | head
```

- [ ] **Step 3: Commit**

```bash
git add src/components/file-tree/view/FileTreeList.tsx
git commit -m "feat(files): file tree list react-window virtualization"
```

---

## Task 9: 编排层适配（FileTreeBody 接新数据 + flatten + 容器测高）

**Files:**
- Modify: `src/components/file-tree/view/FileTreeBody.tsx`（或 `FileTree.tsx`，看哪个编排 useFileTreeData）

- [ ] **Step 1: 读现有编排，定位 useFileTreeData 消费点**

```bash
grep -rn "useFileTreeData\|files\.map\|<FileTreeList" src/components/file-tree/view/ | head
```
找到调用 `useFileTreeData` + `<FileTreeList items={files}>` 的组件（很可能 `FileTreeBody.tsx` 或 `FileTree.tsx`）。

- [ ] **Step 2: 改编排：接新 hook 返回值 + flatten + 容器测高 + 展开 ensureDir**

在编排组件里：

a) 接新 hook：
```tsx
const { entriesByDir, loadingDir, errorDir, ensureDir, refreshDir, refreshAll } = useFileTreeData(selectedProject);
const { expandedDirs, toggleDirectory, collapseAll } = useExpandedDirectories();
```

b) 展开 toggle 包装（toggle + ensureDir 触发懒 fetch）：
```tsx
const handleToggleDir = useCallback((path: string) => {
  toggleDirectory(path);
  // 展开时（expandedDirs 当前不含）→ ensureDir
  // 注意：toggleDirectory 是异步 setState，这里用 !expandedDirs.has 判断"将展开"
  if (!expandedDirs.has(path)) {
    // node.path 是绝对路径；转成 dir key（相对项目根）。projectRoot = selectedProject.fullPath || selectedProject.path
    const root = selectedProject?.fullPath || selectedProject?.path || '';
    const dirKey = path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/, '').replace(/\\/g, '/') : '';
    ensureDir(dirKey);
  }
}, [expandedDirs, toggleDirectory, ensureDir, selectedProject]);
```

> ⚠️ dir key 计算：node.path 绝对 → 相对项目根，正反斜杠统一为 `/`。这必须和 `flattenVisibleNodes` 内部的 dirKey 计算 + `useFileTreeData.fetchDir` 的 dir 参数一致。`flattenVisibleNodes` 用 `parentDirKey + '/' + node.name` 累积（正斜杠），所以这里 dirKey 也要正斜杠、相对根。三者一致。

c) 扁平化可见节点：
```tsx
const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
const visibleRows = useMemo(
  () => flattenVisibleNodes(entriesByDir, expandedDirs, projectRoot),
  [entriesByDir, expandedDirs, projectRoot],
);
```

d) 容器测高（react-window 需要固定 height）：
```tsx
const containerRef = useRef<HTMLDivElement>(null);
const [containerHeight, setContainerHeight] = useState(400);
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const update = () => setContainerHeight(el.clientHeight);
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  return () => ro.disconnect();
}, []);
```

e) 传给 FileTreeList（新 props）：
```tsx
<div ref={containerRef} className="flex-1 min-h-0">
  <FileTreeList
    visibleRows={visibleRows}
    viewMode={viewMode}
    expandedDirs={expandedDirs}
    onItemClick={onItemClick}
    renderFileIcon={renderFileIcon}
    formatFileSize={formatFileSize}
    formatRelativeTime={formatRelativeTime}
    onRename={onRename}
    onDelete={onDelete}
    onNewFile={onNewFile}
    onNewFolder={onNewFolder}
    onCopyPath={onCopyPath}
    onDownload={onDownload}
    onRefresh={refreshAll}
    onToggleDir={handleToggleDir}
    isLoadingDir={(path) => loadingDir.has( /* path → dirKey 同上转换 */ )}
    errorOfDir={(path) => errorDir.get( /* path → dirKey */ )}
    renamingItem={renamingItem}
    renameValue={renameValue}
    setRenameValue={setRenameValue}
    handleConfirmRename={handleConfirmRename}
    handleCancelRename={handleCancelRename}
    renameInputRef={renameInputRef}
    operationLoading={operationLoading}
    height={containerHeight}
  />
</div>
```

> `isLoadingDir`/`errorOfDir` 需要把 node.path（绝对）转 dirKey 查 loadingDir/errorDir。抽个 `pathToDirKey(path, root)` helper（纯函数，utils/）复用 handleToggleDir + 这两回调。

- [ ] **Step 3: 抽 pathToDirKey helper（避免重复）**

新建 `src/components/file-tree/utils/pathToDirKey.ts`：
```ts
/** 绝对 node.path → 相对项目根的 dir key（正斜杠；根目录返回 ''）。 */
export function pathToDirKey(absPath: string, projectRoot: string): string {
  if (!absPath.startsWith(projectRoot)) return '';
  return absPath.slice(projectRoot.length).replace(/^[/\\]+/, '').replace(/\\/g, '/');
}
```
handleToggleDir / isLoadingDir / errorOfDir 都用它。

- [ ] **Step 4: typecheck + build:client**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add src/components/file-tree/view/FileTreeBody.tsx src/components/file-tree/utils/pathToDirKey.ts
git commit -m "feat(files): wire incremental data + flatten + virtualized list"
```

> 文件名按实际编排组件（FileTreeBody 或 FileTree）。

---

## Task 10: 搜索适配（`useFileTreeSearch` 搜已缓存目录）

**Files:**
- Modify: `src/components/file-tree/hooks/useFileTreeSearch.ts`

- [ ] **Step 1: 读现有 useFileTreeSearch**

```bash
cat src/components/file-tree/hooks/useFileTreeSearch.ts
```

- [ ] **Step 2: 适配增量模型（搜已缓存的目录树）**

现有 `useFileTreeSearch` 大概率基于递归 `files` 树搜索。改为基于 `entriesByDir` + `flattenVisibleNodes` 的扁平列表搜索（仅搜已加载目录，未加载目录不搜）。

核心改动：搜索输入态不变，但搜索对象从 `files`（递归树）改为 `flattenVisibleNodes(entriesByDir, allExpandedDirs, root)` 的并集 —— 简化：搜 `entriesByDir` 里所有 cached entries 的节点（不限展开），匹配 name/path。

伪代码（按现有 hook 结构调整）：
```ts
// 收集所有已缓存目录的 entries 扁平化（用于搜索，不受 expandedDirs 限制）
const allCachedNodes = useMemo(() => {
  const all: FileTreeNode[] = [];
  entriesByDir.forEach((cache) => all.push(...cache.entries));
  return all; // 可能含重复 path（不同目录的子项）→ 去重 by path
}, [entriesByDir]);

const filteredNodes = useMemo(() => {
  const seen = new Set<string>();
  return allCachedNodes.filter((n) => {
    if (seen.has(n.path)) return false;
    seen.add(n.path);
    return n.name.toLowerCase().includes(query.toLowerCase());
  });
}, [allCachedNodes, query]);
```

> 行为：搜已加载（缓存）的目录内的节点。未加载目录不搜（用户先展开根目录或刷新可加载更多）。这是 spec 的简化（spec 验收接受）。

> 如果现有 useFileTreeSearch 有复杂的递归搜索 / 高亮 / 路径展示逻辑，尽量保留 UI 行为，只把数据源从 `files` 改为 `allCachedNodes`。

- [ ] **Step 3: 编排层适配搜索结果展示**

搜索结果可能用单独列表（非树）。看编排组件如何渲染搜索结果，适配新数据。如果搜索结果仍走 FileTreeList（虚拟化），visibleRows 改为 filteredNodes（level 0）。

- [ ] **Step 4: typecheck + build:client**

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add src/components/file-tree/hooks/useFileTreeSearch.ts src/components/file-tree/view/
git commit -m "feat(files): search adapts to incremental cached dirs"
```

---

## Task 11: 错误态完善 + 手动验证清单

**Files:**
- 可能 Modify: `src/components/file-tree/view/FileTreeList.tsx`（loading/error 占位行）+ `FileTreeLoadingState.tsx`（复用）

- [ ] **Step 1: 展开 loading 占位（展开目录 fetch 时显示）**

在 `flattenVisibleNodes` 的输出里，"展开但未加载"的目录目前只渲染目录本身。可在渲染层：当 `expandedDirs.has(node.path) && !isLoadingDir(node.path) && !cache` → 已展开但无数据无 loading（异常态）；`isLoadingDir` → FileTreeNode 的 ChevronRight 已 animate-pulse（Task 7 加）。

如需"展开目录下的 loading 行"（目录行下方一行"加载中..."），在 `flattenVisibleNodes` 给展开但未加载的目录插一个占位 VisibleNode `{ node: {name:'加载中...', type:'file', path: loadingKey}, level: level+1 }`。可选增强，非必须。

- [ ] **Step 2: 完整手动验证（desktop 启动）**

```bash
cd D:/workspace/projects/ai/apps/planrla
npm run build:client
npm run desktop &
sleep 10
# 手动测试（观察 UI）：
# 1. 开一个千+ 文件的大项目 → 首屏快（顶层秒出，日志 [files] scan dir="." took Nms）
# 2. 展开含 1000+ 子文件的目录 → 流畅（虚拟化只渲可见 ~30 行）
# 3. 切走再切回该项目 → 瞬切（缓存命中，无 network 请求）
# 4. 等待 5 分钟后展开某目录 → 重新 fetch（TTL 过期）
# 5. 手动刷新按钮 → 清缓存重 fetch 根
# 6. 视图模式 simple/compact/detailed 切换 → 行高变化，列布局正确
# 7. 右键菜单（新建/重命名/删除/复制路径/下载）→ 功能正常
# 8. 重命名 inline 编辑 → 正常
# 9. 上传 → 正常
# 10. 搜索 → 搜已加载目录的文件
# 11. 图像预览（ImageViewer）→ 正常
kill %1
```

Expected: 上述全部正常，无 console error。

- [ ] **Step 3: Commit（如有 loading 占位改动）**

```bash
git add src/components/file-tree/
git commit -m "feat(files): loading placeholder + error polish"
```

---

## 验收清单

**后端**
- [ ] `/files?dir=X` 单层返回，`?dir=` 省略=根
- [ ] 路径穿越（`../`）返回 400
- [ ] server 日志见 `[files] scan ... took Nms`

**前端数据**
- [ ] `cache.test.ts` 4 tests PASS
- [ ] 开项目只 fetch 根；展开目录才 fetch 该目录
- [ ] 5min TTL：过期后展开重 fetch
- [ ] 切项目/手动刷新 → 清缓存重 fetch 根

**前端渲染**
- [ ] `flattenVisibleNodes.test.ts` 6 tests PASS
- [ ] react-window 虚拟化：大目录只渲染可见行
- [ ] 视图模式 simple/compact/detailed 行高/列正确

**功能保留（手动验证）**
- [ ] 视图模式切换 / 文件点击 / 右键菜单 / 重命名 / 上传 / 搜索 / 图像预览 全部正常

**性能（手动观测）**
- [ ] 首次开大项目首屏 `<500ms`
- [ ] 展开 1000 子文件目录 `<100ms`
- [ ] 切回项目瞬切（缓存）

## 风险与回退

- **渲染重构回归**：FileTreeNode/FileTreeList/编排大改，可能遗漏右键/重命名/上传/视图模式依赖。手动验证清单（Task 11 Step 2）全覆盖。
- **react-window 新依赖**：+~6KB gzip；React 18 兼容。回退：换 hand-rolled（复用消息列表窗口模式）。
- **dir key 一致性**：node.path（绝对）→ dirKey（相对根，正斜杠）转换在 `flattenVisibleNodes` / `useFileTreeData.fetchDir` / `handleToggleDir` / `isLoadingDir` / `errorOfDir` 五处必须一致。Task 9 抽 `pathToDirKey` helper 统一。**这是最易出 bug 的点，仔细测**。
- **搜索体验降级**：仅搜已缓存目录。接受（spec 验收）；用户展开根目录可扩大搜索范围。

## Manual Verification (for Archie)

After `npm run desktop`, verify (subagent can't see UI — human must):

**性能（核心收益）**
- [ ] 开大项目（千+ 文件）首屏 <500ms（顶层秒出；server 日志 [files] scan took Nms）
- [ ] 展开 1000+ 子文件目录流畅（虚拟化只渲染可见 ~30 行）
- [ ] 切走再切回项目瞬切（前端缓存命中，无 network）
- [ ] 5min TTL：等 5 分钟后展开某目录 → 重新 fetch
- [ ] 手动刷新按钮 → 清缓存重 fetch 根

**功能保留**
- [ ] 视图模式 simple/compact/detailed 切换 → 行高 + 列正确
- [ ] 文件/文件夹点击 → 正常
- [ ] 右键菜单（新建/重命名/删除/复制路径/下载）→ 正常
- [ ] 重命名 inline 编辑 → 正常
- [ ] 上传 → 正常
- [ ] 搜索 → 搜已加载目录的文件（结果扁平列表）
- [ ] 图像预览（ImageViewer）→ 正常

**无回归**
- [ ] 无 console error
- [ ] 滚动流畅（react-window 拥有滚动，无双滚动条）
