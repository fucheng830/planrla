# 消息虚拟化增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChatMessagesPane 用 @tanstack/react-virtual useVirtualizer + measureElement（动态行高）替代 hand-rolled 104px 估算 windowing，解决不等高消息滚动锚点漂移。

**Architecture:** `ChatMessagesPane` 删 `virtualizedMessages`（scrollSnapshot + ESTIMATED_MESSAGE_HEIGHT + spacer），用 `useVirtualizer`（count + getScrollElement + estimateSize=104 fallback + measureElement 动态真实高）。virtualItems translateY 定位 + measureElement ref 测真实高。auto-scroll 适配 `virtualizer.scrollToIndex`。

**Tech Stack:** React + `@tanstack/react-virtual`、TypeScript。

**Spec:** `docs/superpowers/specs/2026-07-03-message-virtualization-design.md`

---

## 文件结构

**Create:** 无新文件（修改 ChatMessagesPane）。

**Modify:**
- `package.json` + `package-lock.json` — 加 `@tanstack/react-virtual`
- `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` — 替换 hand-rolled windowing → virtualizer

**环境约束:**
- commitlint subject 不允许 PascalCase 词；首词小写
- 提交前确认根目录无 `nul` 文件

---

## Task E1: 装 @tanstack/react-virtual 依赖

**Files:**
- Modify: `package.json` + `package-lock.json`

- [ ] **Step 1: 装依赖**

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/msg-virt
npm install @tanstack/react-virtual
```

- [ ] **Step 2: 确认装上 + typecheck**

```bash
node -e "console.log('@tanstack/react-virtual', require('@tanstack/react-virtual/package.json').version)"
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(chat): add tanstack react-virtual for message virtualization"
```
> Verify no `nul` at root. Subject lowercase-only.

---

## Task E2: ChatMessagesPane 替换 hand-rolled → virtualizer

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`

> 读现有理解：L18 ESTIMATED_MESSAGE_HEIGHT=104 / L125 scrollSnapshot / L187-214 virtualizedMessages useMemo / L218 scrollContainerRef / L325-358 spacer+messages.map。

### Step 1 — 加 virtualizer + 删 hand-rolled

a) 顶部 import 加：
```ts
import { useVirtualizer } from '@tanstack/react-virtual';
```

b) **删** `ESTIMATED_MESSAGE_HEIGHT` 常量（L18）、`scrollSnapshot` state（L125）、rAF readScroll effect（L160-180 ish）、`virtualizedMessages` useMemo（L187-214）。

c) 加 virtualizer（在组件内，scrollContainerRef 附近）：
```ts
const virtualizer = useVirtualizer({
  count: visibleMessages.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 104,
  overscan: 18,
});
```
> `estimateSize: () => 104` 仅初始 fallback；measureElement 渲染后测真实高，覆盖估算。

d) **替换 render 的 virtualizedMessages 块（L325-358）**：

现有：
```tsx
          {virtualizedMessages.enabled && (
            <div aria-hidden="true" style={{ height: virtualizedMessages.topSpacer }} />
          )}

          {virtualizedMessages.messages.map((message, index) => {
            const absoluteIndex = virtualizedMessages.start + index;
            const prevMessage = absoluteIndex > 0 ? visibleMessages[absoluteIndex - 1] : null;
            return (
              <MessageComponent key={getMessageKey(message)} message={message} prevMessage={prevMessage} ... />
            );
          })}

          {virtualizedMessages.enabled && (
            <div aria-hidden="true" style={{ height: virtualizedMessages.bottomSpacer }} />
          )}
```

改为（virtualizer）：
```tsx
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const message = visibleMessages[vItem.index];
              const prevMessage = vItem.index > 0 ? visibleMessages[vItem.index - 1] : null;
              return (
                <div
                  key={getMessageKey(message)}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <MessageComponent
                    message={message}
                    prevMessage={prevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
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
            })}
          </div>
```

> 保留所有 MessageComponent props（与现有一致）。`getMessageKey` 现有（保留）。`key=getMessageKey(message)`（稳定 key）。`data-index` + `ref={virtualizer.measureElement}` 触发动态测高。

### Step 2 — scrollContainerRef 确认（getScrollElement）

`scrollContainerRef`（L218，现有 scroll 容器 ref）作为 virtualizer 的 `getScrollElement`。确认 ref 在外层 scroll div（L218 `<div ref={scrollContainerRef} ... overflow-y-auto>`）—— virtualizer 用它测 scroll + viewport。

### Step 3 — typecheck + build:client

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

### Step 4 — Commit

```bash
git add src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit -m "feat(chat): message pane uses tanstack virtualizer"
```
> Subject lowercase-only. Avoid "ChatMessagesPane" PascalCase → "message pane".

---

## Task E3: auto-scroll 适配 + 手动验证

**Files:**
- Modify: 可能 `ChatMessagesPane.tsx`（auto-scroll effect）或上层（`ChatInterface` / `useChatMessages`）

### Step 1 — 定位现有 auto-scroll / scrollToBottom

```bash
cd D:/workspace/projects/ai/apps/planrla/.claude/worktrees/msg-virt
grep -rnE "scrollToBottom|scrollIntoView|scrollTop\s*=|scrollHeight|auto.?scroll" src/components/chat/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -15
```
找到现有 auto-scroll-to-bottom 逻辑（新消息追加 / session 切换时滚到底）。可能在 ChatMessagesPane 的 effect 或上层 prop。

### Step 2 — 适配 virtualizer.scrollToIndex

在现有 auto-scroll 触发点（新消息 / session 切换），改为：
```ts
virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' });
```

> 如果现有 auto-scroll 用 `scrollContainerRef.current.scrollTop = scrollHeight`，改为 virtualizer.scrollToIndex。
> 如果 auto-scroll 在上层（ChatInterface 等，无 virtualizer 访问），需把 virtualizer 暴露（forwardRef / context）或把 scroll 逻辑移入 ChatMessagesPane。
> 优先：scroll 逻辑在 ChatMessagesPane 内（virtualizer 可访问）。

### Step 3 — typecheck + build:client

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npm run build:client 2>&1 | tail -3
```

### Step 4 — 手动验证（desktop）

```bash
npm run build:client
# desktop 验证（如 worktree native OK）：
# npm run desktop
```
验证清单（手动）：
- 开 1000+ 消息会话 → 滚动流畅（virtualizer 只渲可见 + overscan）
- 长消息（tool diffs / markdown 块）→ 滚动锚点**不漂移**（measureElement 真实高）
- 新消息追加 → auto-scroll to bottom 正常（virtualizer.scrollToIndex）
- session 切换 → scroll-to-bottom 正常
- loadEarlier 分页 → 正常 + scroll 位置合理

### Step 5 — Commit

```bash
git add src/components/chat/
git commit -m "feat(chat): auto scroll via virtualizer scrolltoindex"
```
> Subject lowercase-only. "scrolltoindex" 全小写避 PascalCase。

---

## 验收清单

- [ ] `@tanstack/react-virtual` 装上（package.json）
- [ ] ChatMessagesPane 删 hand-rolled（ESTIMATED/scrollSnapshot/virtualizedMessages/spacer）
- [ ] useVirtualizer + measureElement 替代（动态行高）
- [ ] 1000+ 消息滚动流畅（virtualizer 渲染可见 ~30 行）
- [ ] 长消息（tool diffs/markdown）滚动锚点不漂移（measureElement 真实高）
- [ ] auto-scroll to bottom 正常（virtualizer.scrollToIndex）
- [ ] session 切换 scroll-to-bottom 正常
- [ ] loadEarlier 分页正常
- [ ] B baseline session-switch 不回归（或改善）
- [ ] typecheck + build:client 干净

## 风险与回退

- **measureElement 性能**：1000+ 消息只测可见 + overscan（~30），可接受；virtualizer 缓存已测项。
- **auto-scroll 适配**：现有 scroll 逻辑可能在上层（无 virtualizer 访问）—— 需暴露 virtualizer 或移 scroll 入 ChatMessagesPane。
- **loadEarlier 兼容**：visibleMessages 变（pagination）→ virtualizer count 变 → 自动适配。scroll 位置：loadEarlier 追加历史后，virtualizer 应保持位置（确认）。
- **key 稳定**：getMessageKey(message)（非 index），避免 React 重用错位。
- **回退**：hand-rolled 代码 git 可恢复。
