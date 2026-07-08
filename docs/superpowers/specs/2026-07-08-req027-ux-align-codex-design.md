---
REQ-ID: REQ-027
title: UX 对齐 Codex · 渲染层交互优化(diff 高亮 + plan 展示增强 + diff 行级评论)
date: 2026-07-08
status: spec
owner: Archie
source-req: REQ-021
---

# REQ-027: UX 对齐 Codex · 渲染层交互优化

## 背景

REQ-021(UX 对齐 Codex,backlog)从「对齐 Codex 全特性集」(REQ-022 母项)拆出。本 REQ-027 为 REQ-021 的首个执行切片,聚焦**渲染层交互优化**(backlog 原文「动效 + 网页/图片预览 + 交互优化」中的「交互优化」块;动效 / 图片预览 / 网页预览不在本切片)。

### 审计结论(brainstorming 阶段)

**(1) 对照基线**:经 Archie 确认,「对齐 Codex」指 OpenAI Codex 产品(CLI / 云端 web / IDE / 桌面 app,2026 现状),非上游 nomad fork(nomad 自身也未做这些 UX)。

**(2) planrla 现状远比预期成熟**(代码探索实证,非凭印象):

| Codex 交互点 | planrla 真实现状 | 成熟度 |
|---|---|---|
| reasoning/thinking 折叠 | `shared/view/ui/Reasoning.tsx`(ai-elements 风格):streaming 自动展开 / 结束 1s 自动折叠 / duration 时长 / Shimmer / i18n / BrainIcon | 成熟 |
| tool call 卡片 | config-driven(`tools/configs/toolConfigs.ts`):OneLineDisplay / CollapsibleDisplay + category 配色(edit=amber / bash=green / search=gray / todo,task=violet / plan=indigo) | 成熟 |
| tool 状态徽标 | `deriveToolStatus()` 4 态:running / completed / error / denied(denial 基于 Claude 特定文案) | 成熟 |
| diff 可视化 | `tools/components/ToolDiffViewer.tsx`:line-level 红删绿增 + 文件可点击 + Diff/New/Patch badge | line 级 |
| Plan mode flow | `tools/components/PlanDisplay.tsx`:Card + Collapsible + MarkdownContent + Revise/Build(⌘↵)审批 footer(接 ExitPlanMode permission) | 成熟 |
| Approval flow | `view/subcomponents/PermissionRequestsBanner.tsx`:Deny / Allow Remember(规则)/ Allow Once | ≈ Codex 3 级 |

**(3) 聚焦渲染层,真实差距收敛为 3 项**(联网审计 Codex 2026 + 代码对照,Archie 多选确认):
- **① diff 无语法高亮**(planrla 纯文本红绿;Codex syntax-highlighted)
- **② plan 当 markdown 整块**(planrla 无步骤结构化;Codex 步骤 pending/inProgress/completed——但 planrla 多 provider 架构下拿不到真状态,见「风险与约束」)
- **④ diff 无行级评论**(planrla 无;Codex App 有 inline review——但 planrla 是 provider UI 壳,diff 是事后展示,完整 review 受架构限)

## 目标

- **①** `Edit`/`Write`/`ApplyPatch` 的 diff 渲染带代码语法高亮(与 markdown 代码块一致),保留 +/- 红绿背景与可点击文件名。
- **②** `ExitPlanMode` 的 plan 内容,若含 checkbox / 编号列表,渲染为结构化步骤卡片;自由文本 plan 保持当前 markdown。
- **④** diff 行可加本地评论,评论可一键汇总复制为消息注入 composer(回传 provider 走文本)。
- 三项均 **provider 无关**(Claude Code / Codex / Gemini / Cursor / OpenCode 一致),纯前端。

## 范围

### In scope
- `src/components/chat/tools/components/ToolDiffViewer.tsx`(① 高亮 + ④ 行级评论)
- `src/components/chat/tools/components/PlanDisplay.tsx`(② 步骤结构化)
- 扩展名 → Prism language 推断 util(新建小 util `getLanguageFromPath`,<30 行)
- ④ 评论 → composer 注入路径(callback / context / store,plan 阶段定,见「风险与约束」)
- i18n 文案(④ 评论按钮 / 输入框 / 复制提示;② 步骤标签)→ `src/i18n/locales/*/chat.json`

### Out of scope(明确不做)
- **真·plan 步骤执行状态**(pending/inProgress/completed):provider 不给(Claude Code 静态 plan),硬做需 heuristic(不准)或仅 Codex(不一致)→ Archie 选「展示增强」(无状态)
- **diff-before-apply review / chunk stage/revert**:planrla 是 provider UI 壳,diff 是「已执行」结果展示,provider 已改文件 → 架构层缺失,需自建 sandbox/worktree 执行层,远超本切片
- **④ 评论结构化回传 provider**(行级绑定):架构不支持 → ④ 降级为本地标注 + 文本汇总
- **③ reasoning 分节**:锦上添花,本切片不做
- **动效块**(streaming 打字机 / 消息过渡):REQ-021 另一块,本切片未选
- **图片预览 / 网页 link preview**:REQ-021 另两块,本切片未选

## 方案(方案 A)

三项各自独立,无相互依赖,可并行实施。核心策略:
- **①** 复用 `react-syntax-highlighter`(Prism / oneDark,与 `Markdown.tsx` 代码块一致),**不引新库**;叠加 +/- 列 + 红绿背景。
- **②** 解析 plan markdown 的步骤模式(checkbox `- [ ]`/`- [x]`、编号 `1.`/`2.`),渲染结构化卡片;**无执行状态**。
- **④** diff 行 hover 评论按钮 → popover → 本地组件 state(按行索引);汇总评论 → 注入 composer(文本)。

## 详细设计

### ① diff 语法高亮

**组件**:`ToolDiffViewer.tsx`(当前 93 行)。

**数据流(当前)**:
```
createDiff(oldStr, newStr) → DiffLine[]{ type: 'removed'|'added'|'context', content, lineNum }
每行渲染:<span 红绿背景>{+/- 前缀列}{content}</span>
```

**改造**:
- 从 `filePath` 扩展名推断 language(`.ts/.tsx→typescript`、`.js/.jsx→javascript`、`.py→python`、`.go→go`、`.rs→rust`、`.java→java`、`.md→markdown`、`.json→json`、`.css→css`、`.html→markup` 等),用新建 `getLanguageFromPath()` util
- 每条 diffLine 的 `content` 送 `<SyntaxHighlighter language={lang} style={oneDark}>`(与 `Markdown.tsx` 代码块同库同主题)
- **叠加层级**:红绿背景层(底)→ 语法高亮文字(中)→ +/- 前缀列(保持当前 `w-6` 列,顶)
- 未识别扩展名 / `lang='text'` → fallback 当前纯文本红绿(不高亮)

**边界**:
- 大 diff 性能:`SyntaxHighlighter` 逐行调用对 >200 行 diff 慢 → 已有 `useMemo`(diffLines)扩展到高亮结果 + **diff 行数 > 200 时整体 fallback 不高亮**(纯文本红绿,保留 +/- 与文件名)
- 暗色模式:`oneDark` 固定(与 `Markdown.tsx` 代码块当前行为一致,亮暗都用 oneDark)

**性能保护**:
- `getLanguageFromPath(filePath)` 结果按 filePath memoize
- 单行高亮:若逐行 Prism 仍慢,plan 阶段评估「连续同语言行合并送一次高亮」优化

### ② plan 展示增强

**组件**:`PlanDisplay.tsx`(当前 139 行)。

**当前**:plan `content`(string)→ `<MarkdownContent content={content} />`(整块 markdown)。

**改造**:
- 在 `PlanDisplay` 内对 `content` 做步骤检测:正则匹配 checkbox 行(`^\s*-\s*\[[ x]\]\s+`)或编号行(`^\s*\d+\.\s+`),连续 ≥2 行视为「步骤型 plan」
- 步骤型 → 渲染结构化步骤卡片(序号 / checkbox 图标 + 步骤文本,竖向列表),每步用 `MarkdownContent` 渲染行内 markdown
- 非步骤型(自由文本 plan)→ 保持当前 `<MarkdownContent content={content} />`
- **无执行状态**(纯展示;checkbox `- [x]` 只读显示原状态,非可交互)

**边界**:
- 解析保守:只认明确的 checkbox / 编号模式,歧义时 fallback 整块 markdown(不破坏现有渲染)
- provider 无关:不依赖 provider 输出结构,只对 markdown 文本做模式匹配

### ④ diff 行级评论(降级)

**组件**:`ToolDiffViewer.tsx`(与 ① 同文件)。

**交互**:
- diff 行 hover → 行尾出现评论图标按钮(MessageIcon)
- 点击 → 行下展开 popover(textarea + 保存 / 取消)
- 评论存**组件本地 state**:`Record<lineIndex, string>`(按 diffLine 索引)
- 有评论的行显示评论计数 badge

**「复制为消息」**:
- ToolDiffViewer 顶部 / 底部加「复制评论为消息」按钮
- 点击 → 汇总所有评论为文本(格式:`{filePath}:L{lineNum}\n> {comment}`),注入 composer `input`
- 注入路径(plan Task 1 确认,候选):
  - (a) callback prop `onInsertComposer(text)` 从 ChatInterface 层层传至 ToolDiffRenderer
  - (b) `ComposerContext` 提供 `insertText()`
  - (c) `useSessionStore` 的 composer input action
- ChatComposer 当前接口实证:`input: string` prop + `onInputChange` callback(来自 ChatInterface)

**边界**:
- 评论**本地 state,组件卸载丢失**(不做 localStorage 持久化;如需 plan 阶段评估)
- 不结构化回传 provider(只文本注入 composer,用户可编辑后发送)
- 多个 diff 块(一条消息多个 Edit)各自独立评论 state

## 整体考虑

- **provider 无关**:① 仅靠 filePath(所有 provider 给);② 仅靠 markdown 文本;④ 纯本地。三项对 Claude Code / Codex / Gemini / Cursor / OpenCode 一致。
- **测试**:
  - ① `getLanguageFromPath` 单测(各扩展名)+ ToolDiffViewer 高亮渲染快照(有高亮 / fallback / 大 diff >200)
  - ② 步骤检测单测(checkbox / 编号 / 自由文本)+ PlanDisplay 渲染快照
  - ④ 评论 state + 复制为消息(汇总格式)+ 注入 composer(集成测,plan 定接口后补)
- **i18n**:④ 评论按钮 / popover placeholder / 复制提示;② 步骤标签 → `chat.json`(en + zh-CN,其他 locale fallback en,符合现有惯例)
- **性能**:① memoize + 大 diff fallback;② 步骤解析 memoize(content 不变不重算);④ 评论 state 局部(不触发整 diff 重渲染)
- **文件卫生**:
  - `ToolDiffViewer.tsx`:93 → ~160-180 行(① + ④),<500 ✅;若超预期,拆 `DiffLineComments` 子组件
  - `PlanDisplay.tsx`:139 → ~200 行,<500 ✅;若超,拆 `PlanSteps` 子组件
  - 新建 `getLanguageFromPath` util(<30 行)

## 验收标准

1. **①** 发起任意 Edit/Write/ApplyPatch(已知语言文件,如 .ts/.py),diff 渲染带语法着色(关键字 / 字符串等着色),保留 +/- 红绿背景与可点击文件名;未知扩展名(如 .xyz)fallback 纯文本红绿;>200 行 diff 不卡顿(不高亮,渲染流畅)。
2. **②** provider 输出含 `- [ ] 步骤` 或 `1. 步骤` 的 plan → 渲染为结构化步骤卡片;自由文本 plan → 保持当前 markdown 渲染。
3. **④** diff 任意行 hover → 评论按钮 → 输入评论 → 行显示计数;「复制评论为消息」→ composer input 含汇总文本(文件路径 + 行 + 评论);切换会话 / 刷新后评论清空(本地 state)。
4. **provider 无关**:Claude Code / Codex / Gemini 至少各验一项(① 为主,Claude Code Edit 验)。
5. **质量门**:预检(typecheck + build + git diff --check)全过;无新增 lint warning。

## 风险与约束

- **① 性能**:`SyntaxHighlighter` 逐行调用对大 diff 慢 → 已有 memo + >200 行 fallback 设计;若仍不达标,plan 阶段评估「连续同语言行合并高亮」或换轻量 token 方案。
- **② plan 格式不统一**:各 provider 输出的 plan 格式差异 → 解析保守,只认明确模式,歧义 fallback 整块 markdown(不破坏)。
- **④ composer 注入接口未敲定**:候选 (a) callback prop / (b) ComposerContext / (c) useSessionStore,plan Task 1 确认;不影响 spec 的「做什么」,只影响「怎么接」。
- **④ 架构约束**:planrla 是 provider UI 壳,diff 是事后展示 → 不做 stage/revert/pre-apply review(明确 Out of scope)。
- **范围纪律**:本切片严格限于 ①②④;真步骤状态 / 完整 diff review / ③ / 动效 / 图片网页预览 = 后续切片或 backlog。
