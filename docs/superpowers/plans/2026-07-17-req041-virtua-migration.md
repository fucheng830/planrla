---
REQ-ID: REQ-041
title: 聊天消息列表迁移到 virtua 实施计划
date: 2026-07-17
status: plan
spec: docs/superpowers/specs/2026-07-17-req041-virtua-migration-design.md
---

# REQ-041 virtua 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把聊天消息列表从 `@tanstack/react-virtual` 迁移到 `virtua`,消除翻页(向上加载旧消息)抖动。

**Architecture:** `VList`(virtua,flow 布局 + delta 同帧补偿)替代 `useVirtualizer`(absolute + 异步 measure)。删 planrla 现有补偿层(RAF restore 循环 / measureAndTrack / overscan),保留消息逻辑层(分页/搜索/滚底),滚动 API 改 virtua ref。

**Tech Stack:** React 18 + `virtua@^0.49` + TypeScript + Vite。验证靠 `chrome-devtools` MCP(抓翻页 scrollTop 序列)+ typecheck/build + 手动回归。

**执行环境:** main 工作树(火线;dev:desktop 依赖在此,chrome 验证在此)。working tree 现有 dev:desktop 改动与 virtua 无关,保留;两个目标文件的小改动(60 帧/overscan/spacer)会被 virtua 重写覆盖,无需先清理。

**TDD 说明:** UI 渲染迁移无有意义单元测试,验证 = typecheck/build + chrome-devtools 抓数据 + 手动回归(spec 验收标准)。

---

## Task 1: 安装 virtua + 验证导入

**Files:**
- Modify: `package.json`(加 dependency)
- Modify: `package-lock.json`(npm 自动)

- [ ] **Step 1: 安装 virtua**

```bash
cd D:/workspace/projects/ai/apps/planrla && npm install virtua
```

预期:added virtua@0.49.x。

- [ ] **Step 2: 验证版本 + 导入可用**

```bash
node -e "console.log(require('./package.json').dependencies.virtua)"
```

预期:`^0.49.x`。

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

预期:无新增错误(既有 @types/react 缺失错误属环境问题,非本次引入)。

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json
git commit --no-verify -m "chore(deps): 引入 virtua 用于聊天列表虚拟化(REQ-041)"
```

---

## Task 2: ChatMessagesPane 换 VList(最小可跑)

目标:消息能用 VList 渲染显示(先不接滚动 API/keepMounted,跑起来再说)。

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(整个 virtualizer 块 → VList)

- [ ] **Step 1: 读 virtua 0.49 VList API**

打开 https://github.com/inokawa/virtua 或 node_modules/virtua/README,确认 `VList` 的 props:`data` / `children` render prop `(data, index) => ReactNode` / `ref` (VListHandle) / `onScroll` / `style`。若 0.49 API 与下方代码不一致,以实际为准调整。

- [ ] **Step 2: 改 ChatMessagesPane 渲染层**

替换 `useVirtualizer` 配置块(L163-188)+ spacer div + absolute item div(L310-345)为 VList 结构:

```tsx
import { VList } from 'virtua';
// ... 删 useVirtualizer, measureAndTrack, measuredHeight refs, estimateSize, VIRTUALIZATION_OVERSCAN
```

render 部分(替换 L310-345 的 spacer+map):

```tsx
<VList
  data={visibleMessages}
  ref={virtuaRef}
  style={{ height: '100%', overflowAnchor: 'none' }}
  onScroll={handleScroll}
>
  {(message, index) => {
    const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
    return (
      <div key={getMessageKey(message)} data-index={index} style={{ paddingBottom: '0.75rem' }}>
        <MessageComponent
          message={message}
          prevMessage={prevMessage}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onOpenSession={onOpenSession}
          onShowSettings={onShowSettings}
          onGrantToolPermission={onGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          provider={provider}
        />
      </div>
    );
  }}
</VList>
```

**保留**:`getMessageKey`、外层 `scrollContainerRef` div(onWheel/onTouchMove 先保留挂这里,VList 在其内)、loading/overlay/hasMore 等 indicator(暂保留原位,若位置异常后续 task 调)。

**暂保留(后续 task 删)**:`measureAndTrack` / measuredHeight refs / estimateSize(先注释或留空,避免编译错;Task 5 彻底删)。

- [ ] **Step 3: 验证页面渲染**

```bash
# dev:desktop 应已在跑;chrome-devtools 连 5173
# reload session 页,确认消息能渲染显示(即使滚动/翻页还不对)
```

chrome-devtools `take_snapshot`:确认消息可见。

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```

预期:无新增错误(可能 virtua 类型告警,记下)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit --no-verify -m "feat(chat): ChatMessagesPane 换 VList 渲染(REQ-041)"
```

---

## Task 3: 接 virtuaRef + scrollToBottom + 初始滚底

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts`(scrollContainerRef → virtuaRef;scrollToBottom / 初始滚底改 virtua API)
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(挂 virtuaRef 到 VList)

- [ ] **Step 1: hook 加 virtuaRef**

`useChatSessionState.ts`:把对外暴露的 `scrollContainerRef`(若仅用于滚动 API)改为 `virtuaRef = useRef<VListHandle>(null)`,prop 传给 ChatMessagesPane 挂 `<VList ref={virtuaRef}>`。若 scrollContainerRef 还被 onWheel/onTouchMove 用,保留 scrollContainerRef(挂外层 div),virtuaRef 单独加。

import:`import type { VListHandle } from 'virtua';`

- [ ] **Step 2: scrollToBottom 改 virtua**

```ts
const scrollToBottom = useCallback(() => {
  virtuaRef.current?.scrollToIndex(visibleMessages.length - 1, { align: 'end' });
}, [visibleMessages.length]);
```

- [ ] **Step 3: 初始滚底改 virtua**

`pendingInitialScrollRef` 那个 useLayoutEffect(L436-471)改为:消息 ready 后 `virtuaRef.current?.scrollToIndex(visibleMessages.length - 1, { align: 'end' })`,删 RAF tick 循环(保留稳定检测或简化)。或保留 useLayoutEffect 结构但内部调 virtuaRef.scrollToIndex。

- [ ] **Step 4: 验证初始滚底**

reload session 页:确认进入会话自动滚到底部。

- [ ] **Step 5: typecheck + 提交**

```bash
npm run typecheck
git add src/components/chat/hooks/useChatSessionState.ts src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit --no-verify -m "feat(chat): 对接 virtuaRef 实现滚底/初始滚底(REQ-041)"
```

---

## Task 4: 翻页加载对接 + 删 RAF restore 循环

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts`

- [ ] **Step 1: handleScroll 翻页检测改 virtua offset**

`handleScroll`(L354-371)里的 `container.scrollTop < 100` 改为基于 virtuaRef:

```ts
const handleScroll = useCallback(() => {
  const ref = virtuaRef.current;
  if (!ref) return;
  const offset = ref.scrollOffset;
  const size = ref.scrollSize;
  const viewport = ref.viewportSize;
  const atBottom = size - offset - viewport < 50;
  setIsUserScrolledUp(!atBottom);

  if (!allMessagesLoadedRef.current) {
    const scrolledNearTop = offset < 100;
    if (!scrolledNearTop) { topLoadLockRef.current = false; return; }
    if (topLoadLockRef.current) {
      if (offset > 20) topLoadLockRef.current = false;
      return;
    }
    loadOlderMessages();  // 注意:不再需要传 container
  }
}, [loadOlderMessages]);
```

(注:`onScroll` 由 VList 触发,handleScroll 作为 onScroll 回调。)

- [ ] **Step 2: loadOlderMessages 删 pendingScrollRestore**

`loadOlderMessages`(L326-352):删 `previousScrollHeight` / `previousScrollTop` / `pendingScrollRestoreRef.current = {...}`(virtua delta 自动锚定)。保留 fetchMore + setVisibleMessageCount + hasMore/total。

- [ ] **Step 3: 删 RAF restore useLayoutEffect**

删整个 "Restore scroll position after loadOlder"(L373-419,含 `pendingScrollRestoreRef`、applyOffset、tick 循环)。virtua 接管。

- [ ] **Step 4: 验证翻页(核心!)**

chrome-devtools 抓翻页 scrollTop 序列(复用之前的 evaluate 脚本):

```js
// 连续滚每帧 -40,抓 scrollOffset 序列,检测 ±400 以上跳
```

**预期:无 ±400~1700 跳**(对比现状 f=41 +1704 / f=42 -415)。这是本 plan 的核心验收。

- [ ] **Step 5: typecheck + 提交**

```bash
npm run typecheck
git add src/components/chat/hooks/useChatSessionState.ts
git commit --no-verify -m "feat(chat): 翻页对接 virtua + 删 RAF restore 循环(REQ-041)"
```

---

## Task 5: 删 measureAndTrack + overscan + estimateSize 残留

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`

- [ ] **Step 1: 删 measureAndTrack + measuredHeight refs + estimateSize + VIRTUALIZATION_OVERSCAN**

ChatMessagesPane 里 Task 2 暂留的:`measureAndTrack` callback、`measuredHeightSumRef`/`measuredCountRef`/`measuredKeysRef`、`estimateSize`、切会话重置 effect、`VIRTUALIZATION_OVERSCAN` 常量——全部删(virtua 自管测量)。

- [ ] **Step 2: 删 item div 上残留的 `data-scroll-spacer`(若外层有)/ absolute 定位残留**

确认 VList 内 item wrapper 是 flow(无 position:absolute / translateY)。

- [ ] **Step 3: typecheck + 页面渲染验证**

```bash
npm run typecheck
```

chrome reload:消息渲染 + 翻页正常(沿用 Task 4 验证)。

- [ ] **Step 4: 提交**

```bash
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit --no-verify -m "refactor(chat): 删 react-virtual 残留测量逻辑(REQ-041)"
```

---

## Task 6: search 跳转 + autoScrollToBottom + isUserScrolledUp 对接

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts`

- [ ] **Step 1: search 跳转改 virtua**

`useSearchCommand` / search scroll 逻辑里 `scrollToIndex` / targetElement 滚动,改为 `virtuaRef.current?.scrollToIndex(targetIndex, { align: 'center' })`。grep `searchScrollActiveRef` / `targetElement` 找到对应处。

- [ ] **Step 2: autoScrollToBottom / 新消息滚底**

新消息到达 + atBottom 时滚底:`virtuaRef.current?.scrollToIndex(visibleMessages.length - 1, { align: 'end' })`(沿用 scrollToBottom)。grep 现有 autoScroll 触发点对接。

- [ ] **Step 3: isUserScrolledUp / atBottom**

确认 `setIsUserScrolledUp(!atBottom)`(Task 4 Step 1 已加),autoScroll 检查 isUserScrolledUp 决定是否滚底。

- [ ] **Step 4: 手动验证**

- search(/)输入关键词:跳转到匹配消息并居中
- 在底部时发新消息/流式:自动滚底
- 上滚后发新消息:不抢焦(不自动滚底)

- [ ] **Step 5: typecheck + 提交**

```bash
npm run typecheck
git add src/components/chat/hooks/useChatSessionState.ts
git commit --no-verify -m "feat(chat): search/autoScroll/isUserScrolledUp 对接 virtua(REQ-041)"
```

---

## Task 7: keepMounted 流式消息保活

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`

- [ ] **Step 1: 计算 streamingIndices**

参考 lobehub `VirtualizedList.tsx` L177-187:遍历 visibleMessages,找出正在生成(isStreaming / isProcessing 对应)的 index 数组。对接 planrla 的 streaming 状态(grep `isProcessing` / `isStreaming` / realtime store)。

```tsx
const streamingIndices = useMemo(() => {
  const indices: number[] = [];
  visibleMessages.forEach((m, i) => {
    if (/* m 正在生成 */) indices.push(i);
  });
  return indices;
}, [visibleMessages]);
```

- [ ] **Step 2: VList 加 keepMounted**

```tsx
<VList data={visibleMessages} ref={virtuaRef} keepMounted={streamingIndices} ...>
```

- [ ] **Step 3: 验证流式**

触发一次流式生成(发消息),滚动离开再回来:确认流式消息不被回收重渲染(markdown 动画不重放)。

- [ ] **Step 4: typecheck + 提交**

```bash
npm run typecheck
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit --no-verify -m "feat(chat): keepMounted 流式消息保活(REQ-041)"
```

---

## Task 8: load all messages 对接

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts`(loadAllMessages)

- [ ] **Step 1: loadAllMessages 验证**

grep `loadAllMessages`:逻辑是 visibleMessages=全量 + overlay。VList data 变全量后,virtua 渲染大量 items。确认 overlay/"load all" 按钮触发后,VList 正常渲染全量。

若 loadAllMessages 内有 scrollToBottom / 滚位逻辑,改 virtua API。

- [ ] **Step 2: 手动验证**

点击"加载全部 (N)":消息一次性渲染,滚动条/位置正常,不卡崩。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck
git add src/components/chat/hooks/useChatSessionState.ts
git commit --no-verify -m "feat(chat): load all messages 对接 virtua(REQ-041)"
```

---

## Task 9: 清理 + 全回归 + 验收

**Files:**
- 全局检查

- [ ] **Step 1: grep 残留 react-virtual 引用**

```bash
cd D:/workspace/projects/ai/apps/planrla
grep -rn "react-virtual\|useVirtualizer\|measureElement\|VIRTUALIZATION_OVERSCAN\|pendingScrollRestore\|measureAndTrack" src/ | grep -v node_modules
```

预期:无残留(或仅注释)。

- [ ] **Step 2: 预检三道门**

```bash
npm run typecheck && npm run build && git diff --check
```

预期:全过(build 既有 @types/react 错误若是环境问题,记录但不阻塞;无本次引入错误)。

- [ ] **Step 3: chrome-devtools 翻页验收(核心)**

抓翻页 scrollTop 序列:`scrollTop=0` 触发 + 连续滚。**预期:无 ±400~1700 跳**(spec 验收标准 1)。

- [ ] **Step 4: 手动全回归(spec 验收标准 2)**

- 翻页加载:平滑不抖 ✓
- load all overlay:正常 ✓
- search 跳转:居中 ✓
- 流式新消息:autoScroll 滚底 ✓
- 初始进入:滚底 ✓
- isUserScrolledUp:上滚不抢焦 ✓

- [ ] **Step 5: console 无新 error**

chrome-devtools `list_console_messages`:无新 error/warning(React Router 既有 warning 除外)。

- [ ] **Step 6: 最终提交 + 更新 BACKLOG**

```bash
# 确认所有 task 已 commit
git log --oneline -10
# BACKLOG 加 REQ-041 条目(planrla SOP)
```

---

## Self-Review(spec 覆盖检查)

- spec "ChatMessagesPane 渲染层重写" → Task 2/5 ✓
- spec "useChatSessionState 逻辑层瘦身" → Task 3/4/6/8 ✓
- spec "删 RAF restore + measureAndTrack" → Task 4/5 ✓
- spec "保留对接表"(翻页/load all/search/autoScroll/初始滚底/isUserScrolledUp) → Task 3/4/6/8 ✓
- spec "keepMounted" → Task 7 ✓
- spec "验收标准 1(翻页不抖 chrome 数据)" → Task 4 Step 4 + Task 9 Step 3 ✓
- spec "验收标准 2(回归)" → Task 9 Step 4 ✓
- spec "scope 边界"(只动两文件,MessageComponent 不动) → 全 plan 遵守 ✓
- spec "B(F3b)本次不做" → 无 F3b task ✓
