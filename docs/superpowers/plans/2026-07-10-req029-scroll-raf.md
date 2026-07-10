---
REQ-ID: REQ-029
title: loadEarlier 翻页 scroll 位置保持(RAF 补偿)实施 plan
date: 2026-07-10
spec: _(跳过独立 spec;设计见 BACKLOG REQ-029 四要素 + 本 plan Architecture)_
status: review
owner: Archie
---

# REQ-029 loadEarlier 翻页 scroll 位置保持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。Steps 用 checkbox 跟踪。

**Goal:** 翻页(loadEarlier)后 scroll 视觉位置稳定,对齐初始滚到底的"反复校正直到 scrollHeight 稳定"健壮度,消除 measureElement 异步测高导致的残余下跳。

**Architecture:** `useChatSessionState.ts` 的翻页 scroll 补偿 effect(L373-380)从 one-shot `useLayoutEffect` 改为 RAF loop,复用同文件 L403-434(初始滚到底)已验证的"每帧重算 + 3 帧稳定 / 60 帧上限"模式。同时给 legacy 手动 `loadEarlierMessages`(L797-799,当前无补偿)补 `pendingScrollRestoreRef` 锚点,并把补偿 effect 依赖加 `visibleMessageCount`,让两条翻页路径(自动 `loadOlderMessages` / 手动 `loadEarlierMessages`)共用同一 RAF 补偿。**不动** `ChatMessagesPane` virtualizer、**不动**分页数据模型(`visibleMessages = slice(-visibleMessageCount)`)。

**Tech Stack:** React(useLayoutEffect + requestAnimationFrame)、TypeScript。

---

## 文件结构

**Modify:** `src/components/chat/hooks/useChatSessionState.ts`(仅此一文件)

**环境约束:**
- commitlint subject 不允许 PascalCase 词;首词小写
- 提交前确认根目录无 `nul` 文件

---

## Task 1: 翻页 scroll 补偿 effect → RAF loop(主路径)

**Files:** Modify `useChatSessionState.ts` L373-380

将 one-shot 补偿改为"首帧同步 applyOffset + RAF loop 每帧重算,直到 scrollHeight 3 帧稳定 / 60 帧上限",复用 L403-434 模式。依赖加 `visibleMessageCount`(让 legacy 路径也触发)。

- [ ] **Step 1: 替换 L373-380 effect**

现有(one-shot):
```ts
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;
    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    container.scrollTop = top + Math.max(newScrollHeight - height, 0);
    pendingScrollRestoreRef.current = null;
  }, [chatMessages.length]);
```

改为(RAF loop):
```ts
  // Restore scroll position after loadEarlier expands the visible window.
  // react-virtual's measureElement measures newly-rendered items asynchronously,
  // so scrollHeight keeps growing for several frames after the window expands.
  // The old single-shot offset was computed before all new heights settled →
  // under-compensated → the viewport jumped down (worst on long tool diffs /
  // markdown blocks). Re-apply every frame until scrollHeight stabilizes — same
  // shape as the initial-scroll-to-bottom RAF loop below (L403-434).
  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) return;
    const { height: anchorHeight, top: anchorTop } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;

    const applyOffset = () => {
      container.scrollTop = anchorTop + Math.max(container.scrollHeight - anchorHeight, 0);
    };
    applyOffset(); // first frame synchronous (useLayoutEffect, pre-paint) — avoids initial flash

    let frame = 0;
    let lastHeight = container.scrollHeight;
    let stableCount = 0;
    let rafId = 0;
    const tick = () => {
      if (!scrollContainerRef.current) return;
      applyOffset();
      const currentHeight = container.scrollHeight;
      if (currentHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = currentHeight;
      }
      frame++;
      if (stableCount < 3 && frame < 60) {
        rafId = requestAnimationFrame(tick);
      } else {
        pendingScrollRestoreRef.current = null;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [chatMessages.length, visibleMessageCount]);
```

- [ ] **Step 2: typecheck**
```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
```

---

## Task 2: legacy `loadEarlierMessages` 补锚点(手动路径同补偿)

**Files:** Modify `useChatSessionState.ts` L797-799

legacy 手动按钮当前无补偿。补 `pendingScrollRestoreRef` 锚点;Task 1 已把 effect 依赖加 `visibleMessageCount`,故此路径改动 `visibleMessageCount` 即触发同一 RAF 补偿。

- [ ] **Step 1: 替换 L797-799**

现有:
```ts
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((prev) => prev + 100);
  }, []);
```

改为:
```ts
  const loadEarlierMessages = useCallback(() => {
    // Legacy manual "load earlier" path (non-paginated view). Same measureElement
    // async-height drift applies, so capture an anchor for the shared RAF restore.
    const container = scrollContainerRef.current;
    if (container) {
      pendingScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
    }
    setVisibleMessageCount((prev) => prev + 100);
  }, []);
```

- [ ] **Step 2: typecheck + build:client**
```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

- [ ] **Step 3: Commit**
```bash
git add src/components/chat/hooks/useChatSessionState.ts
git commit -m "fix(chat): keep scroll pos on load earlier via raf loop"
```
> Subject lowercase-only("scrolltoindex" 风格,避 PascalCase)。确认根目录无 `nul`。

---

## 验收清单

- [ ] 主路径(滚顶自动 `loadOlderMessages`):长消息会话(长 tool diff / markdown)连翻 3+ 页,加载完成瞬间**无可见下跳**
- [ ] legacy 路径(手动 `loadEarlierMessages` 按钮):翻页位置保持
- [ ] 短消息会话翻页:不回归(补偿仍正确,RAF 几帧即稳)
- [ ] 初始滚到底行为不变(未动 L403-434)
- [ ] session 切换:scroll 重置正常(session 切换 effect 清 `pendingScrollRestoreRef`,补偿 effect guard 跳过)
- [ ] `npm run typecheck` 干净
- [ ] `npm run build:client` 干净
- [ ] desktop 手动回归(1000+ 消息会话)

## 风险与回退

- **RAF loop 开销**:每帧 applyOffset(一次 scrollTop 赋值)+ 读 scrollHeight,3 帧稳定即停;短消息场景几乎瞬时,长消息最多 ~1s(60 帧)。可接受,与初始滚到底同档。
- **依赖加 `visibleMessageCount`**:session 切换重置 `visibleMessageCount` 会触发本 effect,但 session 切换 effect(L383-391)已先清 `pendingScrollRestoreRef = null` → 本 effect guard `if (!pendingScrollRestoreRef.current) return` 跳过,无副作用。
- **连续翻页**:连续 `loadOlderMessages` 会在 chatMessages.length/visibleMessageCount 连续变化时 cleanup 旧 RAF + 重跑,每次用最新 anchor(loadOlderMessages 每次重设 pendingScrollRestoreRef),正确。
- **回退**:one-shot 实现 git 可恢复。
