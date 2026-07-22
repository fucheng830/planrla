---
REQ-ID: REQ-039
标题: 聊天渲染性能优化(Markdown 解析缓存 + Prism 懒高亮 + RAF 收紧 + memo)
日期: 2026-07-16
状态: spec → 直接实施(设计已在最初性能讨论中对齐)
类型: perf
目标版本: v0.8.5
---

# REQ-039 聊天渲染性能优化

## 1. 问题

切换会话时 UI 卡顿 + 滚动条持续跳动。根因:**每条消息冷挂载时从零渲染 markdown(react-markdown + remark-gfm + remark-math + rehype-katex)+ Prism 代码高亮**,导致:
- scrollHeight 持续变化 → REQ-032 的 RAF 循环跑满 60 帧(1 秒)→ **layout thrashing**(每帧强制 layout)。
- N 条消息 × 每条 10-50ms 渲染 = 切会话停顿数百 ms。

## 2. 设计(方案 A,最初讨论已对齐)

### F1: Markdown 解析缓存(最高杠杆)
- 按 `content hash` 缓存 remark/rehype 的解析产物(AST 或 React 树)。
- 同一内容二次渲染(切回会话、流式增量)命中缓存,跳过完整解析。
- 实现:`Markdown.tsx` 加一层 memo 或 `useMemo(hash → parsed)`。

### F2: Prism 懒高亮
- 代码块用 `IntersectionObserver` 懒挂载高亮(滚进视口才高亮)。
- 或换轻量高亮(只高亮可见代码块,off-screen 推迟)。

### F3: RAF 循环收紧
- `useChatSessionState.ts` 的初始滚底 RAF:60 帧上限 → 20 帧;或用 ResizeObserver 替代轮询。
- 减少 layout thrashing。

### F4: MessageComponent memo comparator
- 自定义 `React.memo` 比较函数(message 内容 hash + 稳定 props)。
- 阻断父级重渲染级联。

## 3. 影响面

| 文件 | 改动 |
|---|---|
| `src/components/chat/view/subcomponents/Markdown.tsx` | F1: 解析缓存 |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | F4: memo comparator |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | (可能:配合 F4) |
| `src/components/chat/hooks/useChatSessionState.ts` | F3: RAF 收紧 |
| 代码块渲染组件(CodeBlock/Markdown code renderer) | F2: Prism 懒高亮 |

## 4. 验收标准

1. 切换会话:**肉眼无可见滚动跳动**(scrollHeight 稳定 < 5 帧)。
2. 切换会话:**体感延迟**显著降低(目标:100 条消息会话切换 < 200ms 可交互)。
3. 流式输出:per-token 不卡顿(解析缓存命中)。
4. `npm run typecheck && npm run build` 干净。
5. REQ-029/031/032 不回归。

## 5. 发版

- **v0.8.5**(patch → 其实是 perf 改善,按 patch 发)。
- 含 REQ-039(F1-F4)。
