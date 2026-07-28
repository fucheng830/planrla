---
REQ-ID: REQ-047
title: 侧边栏 Markdown 文档编辑器(手动 + AI 选段改,对标 Codex)
status: spec
created: 2026-07-28
owner: self
---

# REQ-047 设计:侧边栏 Markdown 编辑器

## 0. 背景与目标(对齐 BACKLOG 四要素)

**背景**:Codex 2026-07-28 新功能——侧边栏直接编辑 `.md`,手动 + AI 编辑(选段让 agent 改,3-5s),用户不再切 Obsidian/VSCode。planrla 全流程文档(spec / plan / BACKLOG / release / README / docs)都是 `.md`,改这些必须切外部编辑器,上下文断。

**目标**:侧边栏入口打开 Markdown 编辑面板,支持:
1. 浏览当前项目的 `.md` / `.markdown` / `.txt` 文件树
2. CodeMirror md 编辑(源码模式 + 预览模式 tab,复用现有 `code-editor` 组件)
3. **AI 选段改**(核心,对标 Codex):选中文本 → silent agent 改写 → inline diff → 接受/拒绝,≤5s,不阻塞编辑器
4. 保存(`Ctrl+S` / `PUT /api/projects/:id/file`,已有)

**范围**:
- server:新增 `GET /api/projects/:projectId/markdown-files`(递归列 md,排除噪音目录)
- 前端:`MarkdownEditorContext` + `MarkdownEditorPanel`(portal)+ 在 `CodeEditor` 增可选 AI 选段改能力 + SidebarHeader 入口按钮 + command palette 命令
- 安全:新 endpoint 强约束(白名单扩展名 + 项目根越界校验 + 大小上限)

**非目标**:
- 不重造 CodeMirror / md 渲染 / 文件保存(全部复用 `code-editor` + `/file` route)
- 不动 REQ-046 BackgroundTasksPanel(其入口未接,本需求不顺手修)
- 不支持非 md/txt(防读源码/配置,白名单硬限)

## 1. 复用清单(不重造)

| 能力 | 已有资产 | 位置 |
|------|---------|------|
| CodeMirror md 编辑 | `CodeEditor` + `MarkdownPreview` | `src/components/code-editor/` |
| md 预览 | `MarkdownPreview`(react-markdown) | `code-editor/view/subcomponents/markdown/` |
| inline diff | `@codemirror/merge` `unifiedMergeView` | `CodeEditor.tsx:121` |
| 文件读 | `GET /api/projects/:id/file?filePath=` + `api.readFile` | `server/index.js:576`,`src/utils/api.js:140` |
| 文件写 | `PUT /api/projects/:id/file` + `api.saveFile` | `server/index.js:676`,`src/utils/api.js:144` |
| 路径越界校验 | `resolved.startsWith(normalizedRoot)` | `server/index.js:598/701/752` |
| silent 通道 | `chat.send { options: { silent: true } }` | REQ-030,`chat-websocket.service.ts:152` |
| silent 事件流 | 每帧带 `silent:true`,前端可订阅过滤 | `chat-run-registry.test.ts:331` |
| stopTask(真 kill) | `POST /api/background-tasks/:id/stop` | REQ-046,`background-tasks/api.ts` |
| session 创建 | `POST /api/providers/sessions` | `provider.routes.ts:493` |
| portal 面板模式 | `BackgroundTasksPanel` | `background-tasks/view/` |
| 命令注册 | command palette sources | `command-palette/sources/` |
| 全局 op 注册 | `usePaletteOpsRegister` | `PaletteOpsContext.tsx` |

**关键发现**:`CodeEditor` 已支持 `diffInfo`(old_string/new_string)→ `unifiedMergeView` 渲染整文件级 diff。AI 选段改只需:把选段替换进文件全文生成 new_full,设 `diffInfo = { old_string: old_full, new_string: new_full }`,现有 diff 机制自动高亮变更块。

## 2. AI 选段改交互设计(对标 Codex 核心)

### 2.1 触发
- **选中文本** → 编辑器内浮动 "AI 改" 按钮(选区上方 popover)
- **次选**:右键菜单项 "AI 改写选段" / 快捷键 `Cmd+K`(Mac)/ `Ctrl+K`(Win)
- **空选段禁用**(按钮灰)

### 2.2 silent agent prompt 模板
```
你是一个 Markdown 编辑助手。改写下面【选段】的文本。

文件:{{relativePath}}
改写要求:{{用户在触发后输入的指令,默认 "润色,保持 md 格式,不超原文长度,保留代码块/链接/标题层级"}}

【选段开始】
{{selectedText}}
【选段结束】

只输出改写后的选段文本(纯 md,不要解释、不要代码围栏、不要前后缀),保持与上下文衔接。
```
- 用户触发后弹一个小输入框填指令(可空走默认),Enter 发送
- prompt 带 `relativePath`(防 agent 脱离文件语境)+ 选段定界标记(防 agent 输出超范围)

### 2.3 silent 通道复用(不新造)
1. **session**:面板首次 AI 改时,lazily 创建一个 "md-editor" 专用 appSession(`POST /api/providers/sessions`,provider = 默认 claude,projectPath = 当前项目 fullPath),缓存到 context。**不污染用户聊天 session 列表**(silent run 不显示)
2. **send**:WebSocket `send({ type: 'chat.send', sessionId, content: prompt, options: { silent: true } })`
3. **回流**:订阅 `useWebSocket().subscribe`,过滤 `event.silent === true && event.sessionId === editorSessionId`:
   - `stream_delta` → 累积 `content` 到 buffer
   - `complete` / `completed` → 收尾,取 buffer 为改后文本
   - `error` → 失败提示
4. **超时**:15s 兜底(silent run 通常 ≤5s,留余量)→ 视为失败
5. **stop**:首版走 silent run 自然完成 / 超时;UI 提供 "取消" 按钮(发 disconnect 或等超时)。实施时若发现 stopTask 能覆盖 silent chat run(按 appSessionId 反查 taskId)则接入,否则标 "取消(等待超时)"。

### 2.4 inline diff 展示
- 拿到改后文本 → 构造 `old_full = 当前文件内容`,`new_full = old_full(选段前) + 改后文本 + old_full(选段后)`
- 设 `file.diffInfo = { old_string: old_full, new_string: new_full, aiEdit: true }`,CodeEditor `useCodeEditorDocument` 命中 diffInfo 分支直接用 new_string 不读盘,`unifiedMergeView({ original: old_string })` 自动高亮
- 新增**接受/拒绝按钮**(仅 `diffInfo.aiEdit === true` 时显示):
  - **接受**:保留 new_full 内容 → 清 `diffInfo` → 标 dirty(待保存)
  - **拒绝**:`setContent(old_full)` 还原 → 清 `diffInfo`

### 2.5 多次迭代
- 接受后用户可再选段触发新一轮(每次 silent run 独立,silent slot 互斥保证串行)
- 拒绝后可立即重选段重试

### 2.6 失败处理(静默 + 提示)
- agent 无响应 / 超时 / error 事件 / stop → 编辑器内 toast("AI 改写失败,请重试"),**不影响编辑器内容**,选段保持
- silent run 失败不污染 chat / 不显示在 BackgroundTasksPanel(silent 标记过滤)

## 3. 文件 API 协议

### 3.1 新增 `GET /api/projects/:projectId/markdown-files`
**响应**:
```ts
type MdFileNode = {
  name: string;
  path: string;       // 项目相对路径(/ 分隔)
  type: 'file' | 'dir';
  children?: MdFileNode[];
};
```

**实现约束**:
- 递归扫描(深度上限 10)
- 排除目录:`node_modules` `.git` `dist` `build` `.next` `out` `coverage` `.cache` `.worktree` `.claude/worktrees`
- 文件白名单:`.md` `.markdown` `.txt`
- 路径校验:`path.resolve` 后 `startsWith(root + sep)`;符号链接 `fs.realpath` 后重校验
- 单文件大小上限:1MB(超过跳过)

### 3.2 现有 route 复用(不改)
- 读:`GET /api/projects/:id/file?filePath=`(已有越界校验)
- 写:`PUT /api/projects/:id/file`(已有越界校验)

## 4. 安全模型

| 风险 | 缓解 |
|------|------|
| 路径穿越 `../` | `path.resolve` 后 `startsWith(root + sep)`;绝对路径拒绝;符号链接 `realpath` 后重校验 |
| 读源码/配置 | 白名单 `.md/.markdown/.txt`;非白名单跳过 |
| 读大文件 DOS | 单文件 >1MB 跳过;递归深度 ≤10 |
| silent prompt 注入 | prompt 选段定界标记;agent 输出仅替换选段(不执行);silent run 不带工具 |
| editor session 污染 | silent run 不显示在 chat / BackgroundTasksPanel(silent 标记过滤) |
| 越权写文件 | 走现有 `PUT /file`(已有越界校验 + 鉴权) |

## 5. 前端架构

```
AppContentInner
├── MarkdownEditorProvider  (state = { isOpen, selectedFile, editorSessionId })
│   ├── open(path?) / close() / selectFile(path)
│   └── MarkdownEditorPanel (portal, isOpen 时)
└── Sidebar
    └── SidebarHeader  (加 FileText 图标按钮 → open())
```

### 组件清单
| 组件 | 职责 | 行数预算 |
|------|------|---------|
| `MarkdownEditorContext.tsx` | Provider + hook | ~150 |
| `MarkdownEditorPanel.tsx` | portal 外壳:.md 树 + CodeEditor | ~180 |
| `MarkdownTree.tsx` | .md 文件树渲染 | ~120 |
| `useAiSelectionEdit.ts` | AI 选段改核心 hook | ~200 |
| `AiEditControls.tsx` | 触发按钮 + 指令输入 + 接受/拒绝 | ~150 |
| `useMarkdownFiles.ts` | 拉取 md 树 | ~60 |

### CodeEditor 改动(最小,可选 prop)
新增可选 prop `enableAiEdit?: boolean` + `aiEditSlot?`(由 useAiSelectionEdit 提供)。默认 false → 现有 caller 零行为变化;true(仅 MarkdownEditorPanel)→ header 增 "AI 改" 按钮,有 aiDiff 时增接受/拒绝。

## 6. 验收标准(对齐 BACKLOG)

- [ ] 侧边栏入口按钮打开 MarkdownEditorPanel(portal)
- [ ] 面板显示当前项目 .md 树(排除 node_modules 等)
- [ ] 点击 .md → CodeEditor 打开(源码模式)
- [ ] 切 preview tab → markdown 渲染正确
- [ ] 手动编辑 → `Ctrl+S` 保存 → 落盘
- [ ] 选段 → "AI 改" → 输入指令 → silent run → ≤15s 返回改后文本
- [ ] inline diff 高亮变更
- [ ] 接受 → 选段被替换 + dirty;拒绝 → 还原
- [ ] 可多次迭代
- [ ] 失败/超时 → 编辑器不受影响,toast 提示
- [ ] 不破坏 chat / sidebar / REQ-046 panel / REQ-030 auto-rename

## 7. 回归风险评估

| 改动文件 | 风险 | 缓解 |
|---------|------|------|
| `server/index.js`(新 endpoint) | 低(纯新增 route) | 不碰 `/file` `/files` |
| `src/utils/api.js`(新方法) | 低(纯新增) | |
| `CodeEditor.tsx`(可选 prop) | 中 | 全可选 + 默认 false,现有 caller 零变化 |
| `SidebarHeader.tsx` / `Sidebar.tsx` | 中(props 链) | 加 1 callback,纯透传,不动 controller |
| `AppContent.tsx`(挂 Provider) | 低 | Provider 独立 |
| command palette(新命令) | 低 | 新 source |

**不动的现有资产**:`useSidebarController`(1079行)、chat composer、BackgroundTasksPanel、auto-rename hook、`/file` `/files` route 逻辑。

## 8. 偏离 BACKLOG 四要素说明

| BACKLOG 写法 | 实际实施 | 原因 |
|-------------|---------|------|
| "复用 chat 代码块 CodeMirror" | 复用 `code-editor` 组件 | `code-editor` 更完整(含 md preview/diff/save/sidebar),chat 代码块是只读展示;用 code-editor 一步到位 |
| "server 文件 API(GET/PUT /api/files)" | 复用现有 `/api/projects/:id/file` + 新增 `/markdown-files` | `/file` 已有完整校验,重造 `/api/files` 重复;仅补递归 md 列表 |
| "≤5s" | 目标 ≤15s(超时兜底),常态 ≤5s | silent agent 冷启动;UI 标注"通常几秒" |
| "选段让 agent 改" | 选段 + 用户填改写指令(默认润色) | Codex 也是用户给指令;纯自动润色质量不可控 |

## 9. 后续(非本需求)

- editor session 用完即删
- AI 选段改历史(多版本回滚)
- 全文 AI 改
- 移动端适配
