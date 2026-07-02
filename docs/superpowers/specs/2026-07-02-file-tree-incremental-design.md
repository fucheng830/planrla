# 文件树增量加载设计（方案 A）

> **状态**：设计待审
> **日期**：2026-07-02
> **范围**：planrla 桌面端文件树（前端 `src/components/file-tree/` + 后端 `server/`），属于 V1 路线图 M2 性能专项的第一个 sub-project

## 背景

当前文件树（`useFileTreeData` + `FileTreeList` + 后端 `getFileTree`）在大会话/大项目场景下有明显性能问题：

- 后端 `getFileTree(dirPath, maxDepth=10)`：每次请求 depth-10 全递归扫描 + 对每项 `lstat` + 全量 JSON serialize。扫描期间阻塞 event loop（其他请求排队）。
- 前端 `useFileTreeData`：一次 `api.getFiles` fetch 整棵树；`FileTreeList` 递归 `.map` 渲染全部节点（无虚拟化）；`FileTreeNode` 递归渲染 children。
- 无缓存（每次 mount/refresh 重新扫描 + 渲染）、无懒加载、无虚拟化。

痛点（用户确认"全面优化"）：
1. 首次开大项目：几秒等待 + 后端阻塞 + 前端全渲染卡顿
2. 展开/渲染含大量子项的目录：前端递归渲染卡顿
3. 切走再切回项目 / 刷新 Files tab：重新全扫 + 全渲

## 目标

方案 A：**后端增量单层扫描 API + 前端按目录懒加载 + react-window 虚拟化 + 目录缓存（5min TTL）**。

预期收益：
- 首次开大项目（千+ 文件）首屏 `<500ms`（顶层扫描 + 渲染顶层），现状几秒
- 展开 1000 子文件目录渲染 `<100ms`（虚拟化只渲染可见 ~30 行），现状卡顿
- 切走再切回瞬切（前端目录缓存），现状重扫
- 后端 `/files` 不再阻塞 event loop（单层扫 vs depth-10 全扫）
- 文件树扫描耗时日志（M2 baseline 观测）

### 非目标（YAGNI）

- ❌ chokidar watch 自动同步代码变动（方案 B，后续可低成本升级 —— 增量 API 不变，只加 watch + SSE）
- ❌ 全树缓存 + watch（方案 C，不解决首屏慢）
- ❌ 后端文件扫描 / Provider 检测的后台任务化（M2 的 F sub-project）
- ❌ 文件内容索引 / 全文搜索（已有 FTS5 会话搜索）
- ❌ 文件树搜索改造（现有 `useFileTreeSearch` 逻辑保留，适配新数据模型）

## 设计

### 1. 后端：增量单层扫描

**新函数 `getFileTreeShallow(dirPath)`**（放在 `server/index.js` 现有 `getFileTree` 附近，或抽到 `server/modules/files/`）：

- 复用现有 `readdir + lstat + IGNORED_DIRS + FS_CONCURRENCY`（acquire/release）逻辑
- **单层扫描**（不递归到子目录）
- 每个目录项额外算 `childrenCount`（直接子项数，仅目录，不递归）—— 供前端显示目录规模提示
- 返回 `[{ name, path, type, size, modified, permissionsRwx, isSymlink?, childrenCount? }]`
- 错误处理沿用现有：EACCES/EPERM 静默跳过

**路由 `GET /api/projects/:projectId/files?dir=<relPath>`**：
- 解析 `projectId` → 项目根 `absPath`（DB，现有逻辑）
- `dir` 省略 / `'.'` / `''` = 项目根
- `targetPath = path.join(absPath, dir)`，**校验 `targetPath` 在 `absPath` 内**（防路径穿越，否则 400）
- 调 `getFileTreeShallow(targetPath)`，返回 entries
- **性能观测**：`const t0 = performance.now(); ...; console.log(`[files] scan ${dir} took ${Math.round(performance.now()-t0)}ms`)`
- 鉴权沿用现有 `authenticateToken`

**旧 `getFileTree`（depth-10 递归）**：保留函数定义（搜索等其他路径可能引用，迁移时 grep 确认），但 `/files` 路由不再调用它。前端切换到增量后，全树 API 无调用方。

> `api.getFiles(projectId, { dir, signal })` 前端封装：URL 改为 `/api/projects/${projectId}/files?dir=${encodeURIComponent(dir)}`。

### 2. 前端数据模型：懒加载 + 缓存

**`useFileTreeData` 重构**（`src/components/file-tree/hooks/useFileTreeData.ts`）：

状态从 `files: FileTreeNode[]`（递归树）改为：
```ts
type DirCache = { entries: FileTreeNode[]; fetchedAt: number };
const [entriesByDir, setEntriesByDir] = useState<Map<string, DirCache>>(new Map());
const [loadingDir, setLoadingDir] = useState<Set<string>>(new Set());
const [errorDir, setErrorDir] = useState<Map<string, string>>(new Map()); // 失败重试
```

行为：
- 开项目（projectId 变化）：`fetchDir(ROOT_KEY)`（ROOT_KEY = `'.'` 或 `''`）
- 展开/折叠目录 `dir`：`useExpandedDirectories.toggle(dir)`；展开时若 `!isCacheValid(entriesByDir.get(dir))` → `fetchDir(dir)`
- `fetchDir(dir)`：abort 旧请求 + setLoading + `api.getFiles(projectId, {dir, signal})` + setEntriesByDir + 设 fetchedAt
- `isCacheValid(cache)`: `cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS`（`CACHE_TTL_MS = 5 * 60 * 1000`）
- 手动刷新（`refreshFiles`）：清 `entriesByDir` + `fetchDir(ROOT_KEY)` + 已展开目录在用户再次展开时懒 refetch（不主动 refetch 所有展开目录，避免风暴）
- AbortController：保留现有按 projectId 的 abort + 扩展为按 dir abort

返回：`{ entriesByDir, loadingDir, errorDir, fetchDir, refreshFiles }`（替代原 `files`）。

### 3. 前端渲染：扁平化 + 虚拟化

**新纯函数 `flattenVisibleNodes(entriesByDir, expandedDirs)`**（`src/components/file-tree/utils/flattenVisibleNodes.ts`）：

- DFS from root（`ROOT_KEY`）：遍历 `entriesByDir.get(ROOT_KEY)`
- 对每个目录节点：若 `expandedDirs.has(node.path)` 且 `isCacheValid(entriesByDir.get(node.path))` → 递归扁平化其 entries
- 返回 `Array<{ node: FileTreeNode; level: number }>`（level = 嵌套深度，决定缩进）
- 跳过未展开 / 未加载 / 缓存过期的子树（展开但未加载的目录渲染占位 loading 行）
- 排序：沿用后端的排序（目录在前 + 字母序），前端不再重排

**`FileTreeList` 重构**：
- 用 `react-window` 的 `FixedSizeList` 渲染 `flattenVisibleNodes` 结果
- 固定行高按 `viewMode`：`simple: 28`、`compact: 24`、`detailed: 40`
- 每行：`<FileTreeNode item={row.node} level={row.level} ... />`（单行 + `paddingLeft: row.level * 16`）
- 替换原递归 `.map`

**`FileTreeNode` 重构**：
- 从递归组件 → **单行渲染单元**（不递归 children）
- 展开箭头：`onClick` → `useExpandedDirectories.toggle(item.path)` + 触发 `fetchDir(item.path)`（若未缓存）
- 保留所有现有 props 适配单行：`onItemClick` / `onRename` / `onDelete` / 右键菜单（`FileContextMenu`）/ 重命名 inline 编辑 / 上传（`useFileTreeUpload`）/ 视图模式列（`FileTreeDetailedColumns`）

**视图模式**：行高 + 列渲染按 `viewMode` 调整，react-window `itemSize` 按 viewMode 取。

**`useFileTreeSearch` 适配**：搜索仍递归找匹配，但需在增量模型上工作（搜已加载目录；未加载目录需先 fetch 或限制搜索范围）—— **搜索行为简化**：仅搜已加载（缓存）的目录，未加载目录先批量 fetch 顶层子树再搜，或限制为"搜已展开的目录"。详细语义在 plan 阶段细化（默认：搜所有已缓存目录）。

### 4. 错误处理 / 测试 / 观测

**错误**：
- `fetchDir` 失败：`errorDir.set(dir, msg)`，该目录的展开箭头显示错误态（红色 + 重试按钮 → 再 `fetchDir`）
- 路径穿越（后端 400）：前端显示"无效路径"
- 权限（EACCES）：后端静默跳过，前端不显示该子项（现有行为）

**测试（纯函数 node:test）**：
- `getFileTreeShallow`（后端）：mock `fsPromises.readdir/lstat`，验证单层 entries + childrenCount + IGNORED_DIRS 过滤 + 排序
- `flattenVisibleNodes`（前端 utils）：构造 `entriesByDir` + `expandedDirs`，验证可见扁平列表（含 level、跳过未展开/未加载）
- `isCacheValid`：fetchedAt 命中/过期边界

> 集成（API 端到端 / react-window 渲染 / 展开折叠交互）用手动验证（desktop 启动 + 实测）。

**观测**：
- 后端：`/files` 路由 `performance.now()` scan 耗时日志（baseline）
- 前端（dev 模式）：`useFileTreeData` fetch 耗时 + `flattenVisibleNodes` 耗时 `console.debug`（轻量，不引入 web-vitals 全套 —— 那是 B sub-project）

## 关键决策（需 spec 审时确认）

1. **虚拟化库**：用 `react-window`（成熟、`FixedSizeList` 适配固定行高）。新增依赖。备选：hand-rolled 复用消息列表窗口模式（无依赖但更多代码 + 测量问题）。**推荐 react-window**。
2. **childrenCount**：目录项带 `childrenCount`（前端显示"100 项"提示 + 决定展开箭头是否有子）。多一次 `readdir` 计数开销，但前端体验好。**推荐带**。
3. **旧全树 API**：前端迁移到增量后，`getFileTree(depth=10)` 不再被 `/files` 路由调用。保留函数定义（grep 确认其他调用方），路由层删 depth 递归分支。**推荐：迁移后删路由全树分支**。

## 风险与回退

- **渲染模型重构**：FileTreeList/FileTreeNode 从递归改扁平虚拟化是大重构，触及视图模式/右键/重命名/上传/搜索。**风险**：遗漏某依赖导致回归。**缓解**：手动验证清单覆盖所有现有功能（见验收）；分阶段 commit（先后端 API + 数据 hook，再渲染重构）。
- **新依赖 react-window**：bundle 体积 +~6KB gzip；与 React 18 兼容（确认）。**回退**：可换 hand-rolled。
- **缓存一致性**：5min TTL 内代码变动不感知。**接受**（手动刷新）；要实时同步升级方案 B。
- **搜索体验**：增量模型下搜索仅搜已加载目录。**接受**（用户可先展开根目录搜索）；或在搜索时触发全加载（退化）。

## 验收清单

- 首次开大项目（千+ 文件）首屏 `<500ms`
- 展开 1000 子文件目录渲染 `<100ms`（虚拟化只渲可见 ~30 行）
- 切走再切回项目瞬切（缓存命中）
- 后端 `/files` scan 耗时日志可见
- **现有功能保留**：simple/compact/detailed 视图模式、文件/文件夹点击、右键菜单（新建/重命名/删除/复制路径/下载）、上传、搜索、图像预览（ImageViewer）、刷新按钮

## 范围

单 spec 覆盖 4 节（一次全做）。建议 plan 按"后端 → 数据 hook → 渲染重构 → 搜索适配"分阶段 commit，每阶段独立验证。
