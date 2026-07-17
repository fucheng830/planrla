---
REQ-ID: REQ-041
title: 聊天消息列表迁移到 virtua,消除翻页抖动
date: 2026-07-17
status: spec
type: design
---

# REQ-041:聊天消息列表迁移到 virtua

## 背景

翻页(向上加载旧消息)时聊天视口剧烈抖动,是产品关键体验缺陷。

**根因(经 chrome-devtools trace + React 渲染机制推导,非猜测)**:`@tanstack/react-virtual` 的 `measureElement` **异步**测量 item 高度,导致翻页加载时发生两次独立 React commit:

1. `setVisibleMessageCount` → render(commit 1):新 item 用 `estimateSize`(滚动平均,虚高)挂载
2. `measureElement` 异步测准真实高度 → virtualizer 内部 setState → 再 render(commit 2):高度回落

两次 commit = 浏览器两次 paint = 用户看到"先虚高再回落"的中间态跳动(实测 scrollTop 在 `1797↔1394↔1790` 三帧来回跳 ±400~1700px)。

**已证伪的补偿层方案**:RAF 逐帧补偿、ResizeObserver、C(estimate 单调化)、减批次、预加载(overscan)——全部无效,因为它们都在 commit **之后**跑,挡不住中间 paint。这是 react-virtual 异步 measure 的结构性限制,补偿层物理上限治不好。

**参考**:
- codex CLI(Rust ratatui TUI)不抖是因为高度是同步纯函数(`line_count(width)`),介质特性不可照搬到 web 富文本。
- lobehub(同类 web 聊天产品,工作区内)已为此从 react-virtual 迁移到 [`virtua`](https://github.com/inokawa/virtua),生产验证。

**virtua 解决机制**:flow 布局 + **delta-based scroll offset**——item 高度从 estimate 收敛到真实值时,把 `delta = realHeight - estimatedHeight` 直接加到 scroll offset,该调整与高度更新落在**同一个 React commit / paint**,用户感知不到中间态。

## 目标

迁移聊天消息列表到 virtua,消除翻页抖动,且不破坏现有滚动/分页/搜索特性。

## 范围

**只动**:
- `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(渲染层重写)
- `src/components/chat/hooks/useChatSessionState.ts`(滚动/分页逻辑层瘦身 + 滚动 API 改 virtua ref)

**不动**:MessageComponent 本身、看板、终端、文件树、其他 chat 子组件。

**依赖新增**:`virtua@^0.49`(最新稳定 0.49.3,peer `react>=16.14`,planrla React 18.2 兼容)。

## 详细设计

### 架构

`VList`(virtua)替代 `useVirtualizer`(react-virtual)。VList 用 flow 布局(非 absolute),内部 delta 补偿接管翻页锚定。planrla 的消息逻辑层(分页/搜索/滚底)**保留**,只换渲染层 + 滚动 API。

### ChatMessagesPane.tsx(渲染层重写)

**删**:
- `useVirtualizer` 配置 + `VIRTUALIZATION_OVERSCAN` 常量
- `measureAndTrack` 回调 + 三个 measuredHeight refs(`measuredHeightSumRef`/`measuredCountRef`/`measuredKeysRef`)
- `estimateSize` + 切会话重置高度的 effect
- `getTotalSize()` spacer div(L310 那层)
- item 的 absolute+translateY 定位 div(L315 那层)

**加**:
- `import { VList, VListHandle } from 'virtua'`
- `VListHandle` ref(由 `useChatSessionState` 创建 `useRef<VListHandle>`,prop 传入挂到 `<VList ref>`,沿用现有 `scrollContainerRef` 透传模式)
- `<VList data={visibleMessages} ref={virtuaRef} keepMounted={streamingIndices} onScroll={handleScroll} style={{ overflowAnchor: 'none' }}>` 
- render prop:`(message, index) => <MessageComponent .../>`(flow 布局,无 translateY)
- `streamingIndices`:正在生成的消息 index 数组(防虚拟列表回收导致 markdown 动画重放,参考 lobehub keepMounted)

### useChatSessionState.ts(逻辑层瘦身)

**删**:
- `pendingScrollRestoreRef` + 翻页 RAF restore useLayoutEffect(L380-419,~40 行)——virtua delta 接管
- `measureAndTrack` 相关(measuredHeight refs)
- `scrollContainerRef`(滚动 DOM 容器)角色由 VList 内部滚动容器接管;hook 改用 `virtuaRef`(VListHandle)做所有滚动 API。`onWheel`/`onTouchMove` 等手势处理迁移到 VList 外层 wrapper 或由 VList 的 `onScroll` 替代(实施时按 virtua API 定)

**改(逻辑保留,API 换 virtua ref)**:
- `scrollToBottom` → `virtuaRef.current?.scrollToIndex(visibleMessages.length - 1, { align: 'end' })`
- `loadOlderMessages`:保留 fetchMore + setVisibleMessageCount 逻辑,**删 pendingScrollRestore 赋值**(virtua 自动锚定)
- `handleScroll`:翻页/底检测改用 `virtuaRef.scrollOffset` / `scrollSize` / `viewportSize`(`scrollOffset < threshold` 触发翻页;`scrollSize - scrollOffset - viewportSize < threshold` 判 atBottom)
- search 命令跳转 → `virtuaRef.scrollToIndex(targetIndex, { align: 'center' })`
- 初始滚底(`pendingInitialScrollRef`)→ virtuaRef mount + 消息 ready 后 `scrollToIndex(last, {align:'end'})`
- `isUserScrolledUp` → 基于 atBottom 计算

### 保留对接(回归底线)

| 现有特性 | virtua 对接 |
|---|---|
| 翻页加载旧消息 | onScroll + scrollOffset 阈值 → loadOlderMessages |
| load all messages(overlay) | visibleMessages=全量,VList 渲染(virtua 处理大量 + flow) |
| search 跳转滚动 | scrollToIndex(targetMsgIndex, {align:'center'}) |
| autoScrollToBottom | 新消息 + atBottom → scrollToIndex(last) |
| 初始进入会话滚底 | mount + ready → scrollToIndex(last) |
| isUserScrolledUp | onScroll 算 atBottom |

## 验收标准

1. **翻页不抖(核心)**:chrome-devtools 连 `localhost:5173`,抓翻页(`scrollTop=0` 触发 + 连续滚)逐帧 `scrollTop` 序列,**不再出现** ±400~1700px 的 commit-间跳动(对比现状 f=41 +1704 / f=42 -415)。肉眼翻页平滑。
2. **回归(全保留)**:
   - load all messages overlay:点击"加载全部",消息一次性渲染,滚动条/位置正常
   - search(/) 命令:跳转到匹配消息并居中
   - 流式新消息:autoScrollToBottom 开启时,新消息自动滚底
   - 初始进入会话:滚到底部
   - 翻页加载:滚到顶加载旧消息,内容锚定不跳
3. **预检**:`npm run typecheck && npm run build && git diff --check` 全过。
4. 不引入新 console error/warning(React Router 既有 warning 除外)。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| virtua 0.49(0.x)API 与 lobehub 0.48 微调 | 实施时按 0.49 实际 API,参考 virtua README + lobehub 范式 |
| flow 布局影响 tool 区 sticky 表头/消息定位(原 absolute) | 迁移后逐一验证 sticky/定位;MessageComponent 内部 CSS 不动,只动外层容器 |
| load all / search 是 planrla 特有(lobehub 无) | 列入手动回归清单,重点测 |
| streamingIndices 计算(基于流式状态) | 参考 lobehub `messageStateSelectors.isMessageGenerating` 模式,对接 planrla 的 streaming 状态 |

## scope 边界 / 后续

- 本次只做 virtua 基础迁移(方案 A)。
- **B(F3b 逐条高度缓存)**:A 验证后若仍有残余抖动,再叠加 WeakMap(by message id)缓存真实高度、翻页喂 virtua estimate。本次不做。
- 不重写 MessageComponent,不动其他 chat 子组件。

## 发版

按 planrla SOP:本设计评审通过 → writing-plans → 实施 → 三道门验收 → 作为 patch 发版(目标 v0.8.6)。BACKLOG 条目补 REQ-041。
