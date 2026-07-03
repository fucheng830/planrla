# 消息虚拟化增强（@tanstack/react-virtual）设计（E sub-project）

> **状态**：设计待审
> **日期**：2026-07-03
> **范围**：planrla 前端 `ChatMessagesPane`，M2 性能专项 E

## 背景

`ChatMessagesPane.tsx` 当前用 hand-rolled windowing：
- 固定 `ESTIMATED_MESSAGE_HEIGHT = 104`（L18）
- `scrollSnapshot`（top + height, rAF-throttled, L125）
- `virtualizedMessages` useMemo：`firstVisibleIndex = scrollSnapshot.top / 104`（L199）、`topSpacer/bottomSpacer = index * 104`（L211-212）
- 启用阈值 `VIRTUALIZATION_THRESHOLD`（240+ 消息）

痛点：**固定 104px 估算** → 不等高消息（长 tool diffs / markdown 块 / 多行文本）实际高度远超 104，导致滚动锚点漂移 + spacer 累积偏差（长会话越滚越偏）。无真实行高测量。

## 目标

用 `@tanstack/react-virtual` 的 `useVirtualizer` + `measureElement`（动态行高原生支持）替代 hand-rolled，**解决 104px 锚点漂移**。

### 非目标（YAGNI）

- ❌ 不改 `visibleMessages` pagination（`useChatMessages` 保留）
- ❌ 不改 top pagination（`loadEarlier` / `loadAllMessages`）
- ❌ 不改 `ChatMessage` 组件渲染
- ❌ 不引入其他虚拟化库（react-window 留给文件树 FixedSizeList）
- ❌ 不改消息数据模型 / store

## 设计

### 1. 替换 hand-rolled windowing（`ChatMessagesPane.tsx`）

删除：
- `ESTIMATED_MESSAGE_HEIGHT` 常量
- `scrollSnapshot` state + rAF `readScroll` 循环
- `virtualizedMessages` useMemo（含 start/end/topSpacer/bottomSpacer）
- `<div style={{ height: topSpacer }}>` / `<div style={{ height: bottomSpacer }}>` spacer divs

新增（`@tanstack/react-virtual`）：
```ts
import { useVirtualizer } from '@tanstack/react-virtual';

const containerRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizer({
  count: visibleMessages.length,
  getScrollElement: () => containerRef.current,
  estimateSize: () => 104,        // 初始估算（未测量项 fallback；测量后覆盖）
  overscan: 18,                   // 与现有 overscan 一致
  // measureElement 默认行为：渲染后测真实 getBoundingClientRect().height
});
```

- `estimateSize: 104` 仅作未测量项的初始 fallback；`measureElement` 渲染后测真实高，**替代固定 104px** → 解决漂移。
- virtualizer 内部管 spacer（translateY 定位 + totalSize），删现有 spacer divs。

### 2. 渲染

```tsx
<div ref={containerRef} style={{ overflowY: 'auto', height: '100%' }}>
  <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
    {virtualizer.getVirtualItems().map((vItem) => {
      const message = visibleMessages[vItem.index];
      return (
        <div
          key={message.id}
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
          <ChatMessage message={message} prevMessage={visibleMessages[vItem.index - 1] ?? null} ... />
        </div>
      );
    })}
  </div>
</div>
```

- `virtualizer.measureElement` ref 测每项真实高（动态）
- `translateY(vItem.start)` 定位（virtualizer 算的累计真实高，非 104*index）
- `key=message.id`（稳定 key，避免 React 重用错位）

### 3. scroll / auto-scroll 适配

现有 auto-scroll to bottom（新消息 / session 切换）需适配 virtualizer：
- `virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })` 替代现有 scroll math
- 在新消息追加 / session 切换 effect 调（读现有 auto-scroll 触发点，替换为 scrollToIndex）

> scroll position 恢复（loadEarlier 后保持位置）：virtualizer 支持，但 loadEarlier 现有逻辑保留（pagination 层），virtualizer 仅渲染 visibleMessages（已分页）。spec 阶段确认 loadEarlier 与 virtualizer 兼容（visibleMessages 变 → virtualizer count 变 → 自动适配）。

### 4. 新依赖

`@tanstack/react-virtual`（+~3KB gzip）。动态行高原生（measureElement），成熟维护。

### 5. 测试

- 纯函数少（virtualizer 是库）—— 主要集成手动：
  - desktop 1000+ 消息会话滚动流畅（virtualizer 只渲染可见 + overscan）
  - 长消息（tool diffs / markdown 块）滚动锚点**不漂移**（measureElement 真实行高）
  - session 切换 scroll-to-bottom 正常
  - loadEarlier 分页正常
- B baseline 度量：`session-switch`（B2 测点）before/after（virtualizer 初始化 + scroll）

## 风险与约束

- **measureElement 性能**：每项渲染后测高（getBoundingClientRect）。1000+ 消息只测可见 + overscan（~30），可接受。如测，virtualizer 缓存行高（已测量项不重测，除非 invalidate）。
- **scroll position 恢复**：loadEarlier 追加历史消息后，scroll 位置应保持（virtualizer 支持，需确认现有 pagination 与 virtualizer 兼容）。
- **auto-scroll 时机**：virtualizer.scrollToIndex 需在 virtualizer 就绪后调（effect 依赖 virtualizer）。
- **key 稳定性**：用 message.id（非 index），避免 React 重用错位（现有 hand-rolled 用 index 切片，virtualizer 用 index 但 key 用 id）。
- **VIRTUALIZATION_THRESHOLD**：现有 240+ 启用 windowing。virtualizer 对小列表也工作（无阈值需）。但保留小列表不 virtualizer（< 240 直接 map）可选优化（YAGNI，先全用 virtualizer）。

## 验收

- 1000+ 消息会话：滚动流畅（virtualizer 渲染可见 ~30 行）
- 长消息（tool diffs / markdown）：滚动锚点不漂移（measureElement 真实高）
- session 切换：scroll-to-bottom 正常（virtualizer.scrollToIndex）
- loadEarlier：分页 + scroll 位置正常
- B baseline session-switch 不回归（或改善）

## 范围

单 spec 可实现。建议 plan 拆：
1. 装 @tanstack/react-virtual 依赖
2. ChatMessagesPane 替换 hand-rolled → virtualizer（+ scroll 适配）
3. 手动验证（1000+ 消息 + 长消息 + session 切换 + loadEarlier）
