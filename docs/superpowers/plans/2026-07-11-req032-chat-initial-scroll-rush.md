# REQ-032 消除「点进会话快速冲到底」初始滚动冲底 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点进/切换会话时首帧即位于底部、无可见滚动冲底,且 RAF 收尾更短。

**Architecture:** 两处局部改动。(F1) 把 `useChatSessionState.ts` 的初始滚底 `useEffect` 改为 `useLayoutEffect`,在首帧绘制前同步锚定 `scrollTop=scrollHeight`,并门控冗余的 50ms `scrollToBottom` 自动滚底 effect;RAF 循环保留但退化为回流校正。(F3) 在 `ChatMessagesPane.tsx` 把固定 `estimateSize:()=>104` 换成已测高度滚动平均,缩短 RAF 尾巴。

**Tech Stack:** React 18 + `@tanstack/react-virtual` + Vite。验证用 `npm run typecheck` + `npm run build` + 手动浏览器观察(项目无单测 runner;scroll 生命周期与 DOM 测高在 jsdom 不可证伪)。

**Spec:** `docs/superpowers/specs/2026-07-11-req032-chat-initial-scroll-rush-design.md`

---

## Pre-flight:建 worktree(项目约定:实施在 worktree,main 只放发版)

- [ ] **Step 0.1:从 main 建独立 worktree**

```bash
git worktree add .claude/worktrees/req032-chat-initial-scroll-rush -b feat/req032-chat-initial-scroll-rush main
```

- [ ] **Step 0.2:进入 worktree 后,确认 spec/BACKLOG 跟随**

spec 与 BACKLOG 改动目前在主 worktree 工作区(未提交)。本计划假定它们随 `feat/req032-chat-initial-scroll-rush` 分支一起提交(见 Task 5)。若 worktree 是从 main 新建且主工作区改动未提交,需先把 spec/BACKLOG 提交到 main 再建 worktree,或把这两个文件复制进 worktree 一并提交。**执行前与 Archie 确认走法。**

---

## File Structure

| 文件 | 责任 | 本次改动 |
|---|---|---|
| `src/components/chat/hooks/useChatSessionState.ts` | 会话消息 state、分页、所有 scroll 逻辑 | F1a:初始滚底 effect `useEffect`→`useLayoutEffect` + 首帧同步锚定(L438-469);F1b:自动滚底 effect 顶部加 pending gate(L740-756) |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | 消息列表虚拟化渲染 | F3:`estimateSize` 改滚动平均 + `measureElement` wrapper 累计实测高度(L123 区加 refs、L151-156 改配置、L275 改 ref) |

**不改**:分页数据模型、虚拟化选型、Markdown/Prism/KaTeX 管线、search-scroll、load-earlier 恢复(L380-415)、REQ-027 diff 滚位、流式贴底逻辑。

---

## Task 1: 基线复现 — 确认"冲底"可观察(改前 before)

**Files:** 无代码改动(纯观察)。目的:确认根因可见,作为改前基线,符合项目"实施前先实测确认根因"约定。

- [ ] **Step 1.1: 启动 dev**

```bash
npm run dev
```

打开 Web 端(默认 `http://127.0.0.1:5173`,或内网 `192.168.0.13:5173`)。

- [ ] **Step 1.2: 选一个长会话观察**

选一个 **>100 条、含代码块/长 tool diff** 的会话,点击进入。为放大现象,可在 Chrome DevTools → Performance → CPU throttle 选 4x slowdown 后再点。

**Expected(改前基线):** 能**肉眼看到**画面从会话顶部快速下冲到底部(滚动条明显从上往下跑),而非直接出现在底部。

- [ ] **Step 1.3: 记录基线结论**

口头/笔记记下"冲底可见、约 N 帧下冲"。不提交。后续 Task 2 后此处应观察不到下冲。

> 若**观察不到**冲底:停止,回头与 Archie 确认复现路径(会话长度、provider、是否流式中)。根因若与 §3 不符,需回到 spec 修订,勿盲改。

---

## Task 2: F1a — 初始滚底 `useLayoutEffect` 首帧锚定

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts:438-469`

`useLayoutEffect` 已在文件顶部导入(L1:`import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';`),无需新增 import。

- [ ] **Step 2.1: 把初始滚底 effect 改为 useLayoutEffect + 首帧同步锚定**

找到 L438 起的初始滚底 effect(注释含 "Initial scroll to bottom — robust to lazy content reflow."),将其整体替换为:

```js
  // REQ-032 F1a: useLayoutEffect(非 useEffect)+ 首帧绘制前同步锚定 scrollTop,
  // 使首帧即位于底部,消除"顶部→底部"可见冲底。RAF 循环保留,职责退化为
  // 回流校正(markdown/代码/图片落位),因用户已在底部,读作"贴住"而非"下冲"。
  // 同文件 L380 的"加载更多滚位恢复"已用同款 useLayoutEffect+RAF 模式,此处对齐。
  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;
    if (chatMessages.length === 0) { pendingInitialScrollRef.current = false; return; }
    if (searchScrollActiveRef.current) { pendingInitialScrollRef.current = false; return; }

    const container = scrollContainerRef.current;

    // 首帧绘制前同步钉到底 —— 关键:这是用户"看不到滚动"的直接来源。
    container.scrollTop = container.scrollHeight;

    let frame = 0;
    let lastHeight = container.scrollHeight;
    let stableCount = 0;
    let rafId = 0;

    const tick = () => {
      if (!pendingInitialScrollRef.current || !scrollContainerRef.current) return;
      container.scrollTop = container.scrollHeight;
      if (container.scrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = container.scrollHeight;
      }
      frame++;
      if (stableCount < 3 && frame < 60) {
        rafId = requestAnimationFrame(tick);
      } else {
        pendingInitialScrollRef.current = false;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);
```

与原代码的差异(供 review):
1. `useEffect` → `useLayoutEffect`;
2. 在 RAF 启动前新增 `container.scrollTop = container.scrollHeight;`(首帧同步锚定);
3. `let lastHeight = 0` → `let lastHeight = container.scrollHeight`(用锚定高度做基线,避免首帧无谓的 stableCount 重置);
4. 依赖数组、gate、RAF 终止条件、cleanup 全部不变。

- [ ] **Step 2.2: typecheck + build**

```bash
npm run typecheck && npm run build:client
```

**Expected:** 两命令均 exit 0,无报错。

- [ ] **Step 2.3: 手动验证 — 冲底消失**

`npm run dev`,重复 Task 1.2 的长会话(可保留 CPU 4x throttle)。

**Expected:** 点进会话**首眼即在底部,看不到从顶部下冲的动作**;回流期间画面"贴住底部",无下冲观感。

- [ ] **Step 2.4: 流式/回归快查**

在该会话里发一条新消息触发流式响应。

**Expected:** 流式输出仍自动贴底(此时由 L740 自动滚底 effect 接管,pending 已 false)。

- [ ] **Step 2.5: 提交**

```bash
git add src/components/chat/hooks/useChatSessionState.ts
git commit -m "fix(chat): REQ-032 anchor initial scroll to bottom before paint

useLayoutEffect + synchronous scrollTop=scrollHeight before first paint,
so entering a session never shows the top→bottom rush. RAF loop demoted
to reflow-correction only. Aligns with the existing useLayoutEffect
scroll-restore at L380."
```

---

## Task 3: F1b — 门控冗余的 50ms 自动滚底

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts:740-756`

- [ ] **Step 3.1: 在自动滚底 effect 顶部加 pending gate**

找到 L740 起的 effect(依赖 `[autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]`,内含 `setTimeout(() => scrollToBottom(), 50)`),在 effect 体最前面加一行 gate:

```js
  useEffect(() => {
    // REQ-032 F1b: 初始锚定窗口(pendingInitialScrollRef=true)由 F1a 的
    // useLayoutEffect + RAF 独占定位;此 effect 跳过,避免初始加载时冗余的
    // 50ms scrollToBottom 二次拽底、再造冲底。pending 置 false(RAF 收尾)后,
    // 此 effect 恢复本职:管"初始稳定后新追加消息"的自动贴底(流式/工具结果)。
    if (pendingInitialScrollRef.current) return;
    if (!scrollContainerRef.current || chatMessages.length === 0) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) return;
    if (searchScrollActiveRef.current) return;

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) setTimeout(() => scrollToBottom(), 50);
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;
    if (heightDiff > 0 && prevTop > 0) container.scrollTop = prevTop + heightDiff;
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);
```

差异:仅在最前面新增 `if (pendingInitialScrollRef.current) return;`。`pendingInitialScrollRef` 是 ref(L132 定义),不需进依赖数组(与该 effect 现有 `isLoadingMoreRef` 等 ref 用法一致)。

- [ ] **Step 3.2: typecheck + build**

```bash
npm run typecheck && npm run build:client
```

**Expected:** 两命令均 exit 0。

- [ ] **Step 3.3: 手动验证 — 无二次拽底 + 流式不回归**

`npm run dev`,长会话点进观察。

**Expected:**
1. 点进瞬间无"先到底又微跳一下"的二次下冲(50ms 那次已被 gate 掉);
2. 触发流式响应,**仍自动贴底**(pending 在流式前已 false,gate 放行);
3. 流式中途手动上滑,**不再被强制拉回**(isUserScrolledUp 逻辑不受 gate 影响)。

- [ ] **Step 3.4: 提交**

```bash
git add src/components/chat/hooks/useChatSessionState.ts
git commit -m "fix(chat): REQ-032 skip redundant auto-scroll during initial anchor

Gate the 50ms scrollToBottom auto-scroll effect with pendingInitialScrollRef
so it doesn't fire a second bottom-pull on initial load. Streaming auto-scroll
(after the anchor RAF settles) and user-scroll-up behavior are unaffected."
```

---

## Task 4: F3 — estimateSize 改滚动平均

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(L123 区、L151-156、L275)

`useCallback`/`useRef` 已在 L2 导入(`import { useCallback, useRef } from 'react';`),无需新增 import。

- [ ] **Step 4.1: 在现有 refs 后新增测高累计 refs**

找到 L122-125:

```js
  const { t } = useTranslation('chat');
  const messageKeyMapRef = useRef<WeakMap<ChatMessage, string>>(new WeakMap());
  const allocatedKeysRef = useRef<Set<string>>(new Set());
  const generatedMessageKeyCounterRef = useRef(0);
```

在其后追加:

```js
  // REQ-032 F3: 已测消息高度的滚动平均 → estimateSize。
  // ① 让虚拟器预测量 spacer(getTotalSize)接近真实内容高度,缩短初始滚底 RAF 尾巴;
  // ② 顺带缓解 REQ-031 的 estimateSize 虚高根因(不覆盖其 measureElement 重测工作)。
  // 种子 104 = 原 estimateSize 常量。WeakSet 防同一元素多次计入。
  const measuredHeightSumRef = useRef(0);
  const measuredCountRef = useRef(0);
  const measuredElsRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
```

- [ ] **Step 4.2: virtualizer 配置 — estimateSize 改滚动平均**

找到 L151-156 的 `useVirtualizer` 配置,替换 `estimateSize`:

```js
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () =>
      measuredCountRef.current > 0
        ? measuredHeightSumRef.current / measuredCountRef.current
        : 104,
    overscan: VIRTUALIZATION_OVERSCAN,
  });
```

- [ ] **Step 4.3: 新增 measureAndTrack wrapper(包住 virtualizer.measureElement)**

在 `getMessageKey` 的 `useCallback` 之后、`useVirtualizer` 调用之后,新增(wrapper 必须在 virtualizer 创建之后定义,因为它引用 `virtualizer`):

```js
  // REQ-032 F3: 包一层 measureElement —— 在虚拟器测量之前,先把挂载元素实测高度
  // 计入滚动平均。ref 回调只在元素挂载/卸载时触发;WeakSet 防同一元素重复计入。
  // 注意:virtualizer 实例在 useVirtualizer 内部稳定,故 [virtualizer] 依赖稳定,
  // measureAndTrack 引用稳定,ref 回调不会每渲染触发。
  const measureAndTrack = useCallback((el: HTMLElement | null) => {
    if (el && !measuredElsRef.current.has(el)) {
      measuredElsRef.current.add(el);
      const height = el.getBoundingClientRect().height;
      if (height > 0) {
        measuredHeightSumRef.current += height;
        measuredCountRef.current += 1;
      }
    }
    virtualizer.measureElement(el);
  }, [virtualizer]);
```

> 放置位置:放在 `const virtualizer = useVirtualizer({...})` 之后、`return (` 之前。

- [ ] **Step 4.4: 把虚拟项的 ref 换成 measureAndTrack**

找到 L275:

```jsx
                  ref={virtualizer.measureElement}
```

替换为:

```jsx
                  ref={measureAndTrack}
```

- [ ] **Step 4.5: typecheck + build**

```bash
npm run typecheck && npm run build:client
```

**Expected:** 两命令均 exit 0。留意 `react-hooks/exhaustive-deps` 是否对 `[virtualizer]` 报警(应为稳定依赖,不报警;若报,确认 virtualizer 引用稳定后酌情加 eslint-disable 并注明)。

- [ ] **Step 4.6: 手动验证 — 收尾更短 + 不引入留白回归**

`npm run dev`,长会话点进。

**Expected:**
1. 点进仍在底部、无冲底(F1 仍生效);
2. 滚动浏览,高度稳定、无抖动;快速上滑加载更多(REQ-029 范围)位置不回归;
3. **不引入新的底部大片留白**(那是 REQ-031 的活;若 F3 反而让留白更明显,记下现象交回 spec,不要在本次里扩范围去修 measureElement 重测)。

- [ ] **Step 4.7: 提交**

```bash
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit -m "perf(chat): REQ-032 dynamic estimateSize via measured-height average

Replace constant estimateSize 104 with a rolling average of observed message
heights (tracked via a measureElement wrapper). Virtualizer pre-measurement
spacer stays closer to real content → shorter initial-scroll RAF tail.
Seed 104 retained until first measurement. Does not touch measureElement
re-measure strategy (REQ-031 scope)."
```

---

## Task 5: 回归扫描 + 终态验收

**Files:** 无新改动(纯验证 + 收尾提交)。

- [ ] **Step 5.1: 全量预检(CLAUDE.md 验收三道门之预检)**

```bash
npm run typecheck && npm run build && git diff --check
```

**Expected:** 全 exit 0,`git diff --check` 无空白错误。

- [ ] **Step 5.2: 功能回归(对照 spec §7 验收标准,由 Archie 验)**

逐条核对:
1. 长会话(>100 条,含代码/diff)点进 → **无下冲**,首眼在底;
2. 快速连续切换多个会话 → 每次稳定锚底,无闪烁/回弹/二次下冲;
3. 流式输出期间 → **仍自动贴底**;
4. 上滚加载更多(REQ-029)→ 位置保持不回归;
5. 搜索跳转 → 落地正确,不被初始锚定干扰;
6. 短会话(1-3 条)点进 → 直接在底,无异常。

**Expected:** 6 条全过。任一不过 → 退回对应 Task 修,勿标完成。

- [ ] **Step 5.3: 提交 spec + BACKLOG(若 Pre-flight 选择随分支提交)**

```bash
git add docs/superpowers/specs/2026-07-11-req032-chat-initial-scroll-rush-design.md docs/process/BACKLOG.md
git commit -m "docs(req032): spec + BACKLOG entry for initial scroll rush fix"
```

> 提交前确认根目录无 `nul` 文件(项目约定):`ls nul 2>/dev/null || echo "no nul, safe to commit"`(bash 下 `nul` 不存在即 echo)。

- [ ] **Step 5.4: BACKLOG 状态推进**

REQ-032 在 BACKLOG 由 `spec` → 实施完成后推进到 `doing` → `review`(由 Archie 验收后置 `accepted`)。本步骤仅状态记录,可在 Step 5.3 的提交里一并改 BACKLOG 备注列。

---

## Self-Review(plan 作者自查,已执行)

**1. Spec coverage:**
- §4.1 F1a(useLayoutEffect + 首帧锚定)→ Task 2 ✓
- §4.1 F1b(门控 50ms)→ Task 3 ✓
- §4.2 F3(estimateSize 滚动平均)→ Task 4 ✓
- §7 验收 1-7 → Task 5.2 逐条覆盖 ✓(验收 7 typecheck+build → Step 5.1)
- §8 根因实测确认 → Task 1 ✓
- §9 REQ-031 边界 → Task 4.6 Expected 明示不扩范围 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个改代码 step 均给出完整 old/new 代码块;命令含 expected;无"similar to Task N"。

**3. Type/引用一致性:**
- `pendingInitialScrollRef`(L132 定义)在 Task 2/3 引用一致 ✓
- `measuredHeightSumRef` / `measuredCountRef` / `measuredElsRef` / `measureAndTrack` 定义(Task 4.1/4.3)与使用(4.2/4.4)命名一致 ✓
- `virtualizer.measureElement` → `measureAndTrack` 替换一致 ✓
- import 复核:`useLayoutEffect`(L1 已导入)、`useCallback`/`useRef`(L2 已导入)均无需新增 ✓

**4. 风险点已内嵌:** Task 1(根因不符则停)、Task 3.3(流式/上滑不回归)、Task 4.6(不越界到 REQ-031)、Step 5.3(nul 检查)。
