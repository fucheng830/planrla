---
REQ-ID: REQ-032
标题: 消除「点进会话快速冲到底」初始滚动冲底
日期: 2026-07-11
状态: spec
类型: fix
---

# REQ-032 消除「点进会话快速冲到底」初始滚动冲底

## 1. 背景

Archie 反馈核心体感痛点:点击(或切换)进入一个会话时,画面会**从顶部快速"冲"向底部**,像被强制滚轮拉下去,体感很差。理想体感是**点进去首眼就在底部**(像 Slack / iMessage 打开聊天),看不到任何滚动动作。

代码静态分析定位到根因(见 §3):初始滚底逻辑是 `useChatSessionState.ts` 的一个 **`useEffect`(post-paint)+ RAF 循环**(L438-469),首帧绘制时 `scrollTop=0`(画的是会话顶部),RAF 在绘制后才开始逐帧把 `scrollTop` 拽到底 → 用户看见"从顶冲到底"。同文件的"加载更多滚位恢复"用的是 `useLayoutEffect`(L380-415,绘制前同步),**两者生命周期不一致,这正是 bug 所在**。

## 2. 目标 / 非目标

**目标**:
- 点进 / 切换会话时,**首帧即位于底部、无可见滚动动作**;后续回流(markdown/代码/图片落位)只做"贴住底部"的微调,不再有"下冲"观感。
- `estimateSize` 估计更准(滚动平均替代固定 104),初始锚定更接近最终位置,RAF 收尾漂移更短。

**非目标**:
- ❌ 不动 Markdown / Prism / KaTeX 渲染管线(那是"渲染成本"主线,见 §9,独立排期)。
- ❌ 不动虚拟化选型(`@tanstack/react-virtual` 已落地)、不动分页数据模型(`visibleMessages = slice(-visibleMessageCount)`)。
- ❌ 不解决"对话底部大片留白"——那是 **REQ-031** 的范围(F3 会顺带缓解其根因①,但不覆盖其 measureElement 重测等完整工作,见 §9)。
- ❌ 不改"加载更多翻页滚位保持"——那是 **REQ-029**(已 merge)。

## 3. 根因

初始滚底 RAF 循环(`useChatSessionState.ts:438-469`):

```
首次提交消息到 DOM 时 scrollTop = 0           → 第 1 帧画会话顶部(用户看见顶)
useEffect(post-paint)启动 RAF                  → 第 2 帧起逐帧 scrollTop = scrollHeight
                                                 (RAF 最多 60 帧 / ~1s,或 scrollHeight 连续 3 帧稳定为止)
```

叠加因素:
- `:740-756` 的自动滚底 effect 在初始加载时也会触发一次 `setTimeout(() => scrollToBottom(), 50)` —— 第二次冗余拽底。
- 消息里的 Markdown / 代码高亮 / 图片在后续帧持续回流,`scrollHeight` 一直增长,RAF 一直追,延长了"冲"的时长。
- `estimateSize: () => 104`(`ChatMessagesPane.tsx:154`)对高消息偏差极大,初始锚定偏离最终位置,RAF 要追更多帧。

对比:`:380-415` 的"加载更多滚位恢复"是 `useLayoutEffect`(绘制前同步),不存在此问题——为本 spec 的修法提供了同文件内已验证的参照模式。

## 4. 设计

### 4.1 F1 —— 首帧绘制前锚定(`useChatSessionState.ts`)

1. **初始滚底 effect `useEffect` → `useLayoutEffect`**(L438-469):依赖数组、gate、RAF 清理逻辑不变。在 layout effect 体里**首帧绘制前同步** `container.scrollTop = container.scrollHeight`;RAF 循环保留,但因其职责退化为"回流校正",用户已在底部,每帧的 `scrollTop=scrollHeight` 变成"贴住"而非"下冲"。
2. **门控冗余的 50ms `scrollToBottom`**(`:740-756` 的自动滚底 effect):在 effect 体顶部加 `if (pendingInitialScrollRef.current) return;`。初始定位由 F1 的 layout anchor + RAF 独占;该 effect 退回本职——只管"初始稳定后新追加消息"的自动滚底(流式新 token、新工具结果)。**不删,只加 gate**。
3. **不动**:search-scroll(`searchScrollActiveRef` 已 gate,初始 effect L441 早退)、load-earlier 滚位恢复(`:380`)、REQ-027 的 `scroll-mt-4` / `scrollIntoView`、流式贴底(由 `:740` effect 在 gate 之后接管)。

**为什么安全**:把 `:438` 换生命周期是局部改动,`:380` 已有同款 `useLayoutEffect` + RAF 模式做参照;`pendingInitialScrollRef` 在会话切换时被重置为 `true`(`:420`),保证每次进入会话都重新锚定;`pendingInitialScrollRef` 在 RAF 收尾(连续 3 帧稳定 / 满 60 帧)后置 `false`,`:740` effect 自动接管后续追加。

### 4.2 F3 —— estimateSize 滚动平均(`ChatMessagesPane.tsx`)

`estimateSize: () => 104`(L154)改为**已测高度的滚动平均**(种子 104):

- 包一个 `measureElement` wrapper:在 react-virtual 的 `measureElement` ref 回调里,读取挂载元素的实测高度(`getBoundingClientRect().height`),累加到 `measuredHeightSumRef` / 计数到 `measuredCountRef`。
- `estimateSize: () => (measuredCountRef.current ? measuredHeightSumRef.current / measuredCountRef.current : 104)`。
- 防重复计数:用 `WeakSet<Element>` 跟踪已计入元素(或 ResizeObserver),**具体机制 plan 阶段定**。

效果:估计值落到真实高度区间,初始锚定(`scrollTop = scrollHeight`,其中 scrollHeight ≈ `count × 平均高度`)更接近最终位置,RAF 收尾漂移显著变小。

**进阶 F3b(本次不做,留后续)**:按 messageKey 缓存每条消息高度 → per-index `estimateSize`,二次滚动近乎零重测。YAGNI,先看 F3a(滚动平均)是否够。

## 5. 数据流

```
点进 / 切换会话
  → session-change effect(:418-426)置 pendingInitialScrollRef = true
  → 主加载 effect(:472)fetchFromServer → store 更新 → chatMessages 填充、isLoading=false
  → 重渲染,F1 的 useLayoutEffect 在【绘制前】触发:
      同步 container.scrollTop = container.scrollHeight   ← 首帧即到底,看不到滚动
      启 RAF:每帧 scrollTop = scrollHeight(回流校正:贴住底部)
        终止条件:scrollHeight 连续 3 帧稳定,或满 60 帧
      → pendingInitialScrollRef = false
  → 后续流式新 token / 新消息:
      :740 自动滚底 effect(pendingInitialScrollRef 已 false,gate 放行)接管贴底
```

## 6. 影响面 / 文件

| 文件 | 改动 |
|---|---|
| `src/components/chat/hooks/useChatSessionState.ts` | **F1**:L438-469 初始滚底 effect `useEffect`→`useLayoutEffect` + 首帧同步锚定;`:740-756` 自动滚底 effect 顶部加 `if (pendingInitialScrollRef.current) return;` |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | **F3**:L151-156 virtualizer 配置——`measureElement` wrapper 累计实测高度 + `estimateSize` 改滚动平均 |
| **不改** | 分页数据模型、虚拟化选型、Markdown/Prism/KaTeX 管线、search-scroll、load-earlier 恢复、REQ-027 diff 滚位、流式贴底逻辑 |

## 7. 验收标准

1. 点进一个**长会话(>100 条,含代码块 / 长 tool diff)**,**看不到从顶部下冲的动作**,首眼即在底部。
2. **快速连续切换**多个会话,每次都稳定锚到底,无闪烁 / 回弹 / 二次下冲。
3. **流式输出期间仍自动贴底**(F1 gate 之后由 `:740` effect 接管,行为不回归)。
4. **上滚加载更多**(REQ-029 范围)位置保持不回归。
5. **搜索跳转**落地(`searchScrollActiveRef` 路径)正确,不被初始锚定干扰。
6. 短会话(1-3 条)点进也直接在底,无异常。
7. `npm run typecheck && npm run build` 通过;`git diff --check` 干净。

## 8. 测试 / 验证

- **根因实测确认(实施第一步)**:改前先打开一个长会话,用 Chrome DevTools Performance / 或在 `:438` effect 首行加临时日志,确认"首帧 scrollTop=0、RAF 逐帧下拽"确实发生,作为改前基线。
- **改后对照**:同会话,确认首帧 `scrollTop` 已 ≈ `scrollHeight`(绘制前锚定生效),RAF 期间无可见下冲。
- **回归用例**:① 流式贴底;② 上滚加载更多(REQ-029);③ 搜索跳转;④ 会话连切;⑤ 短会话。
- **F3 量化**:对比改前/改后 RAF 收尾帧数(`stableCount` 达标帧数),确认 estimateSize 改进后收尾更快。
- 可选:复用项目已有 `shared/perf/timing`(`measureAsync`)给"会话首帧锚定"加一个测点。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| **与 REQ-031 撞 `estimateSize`**:REQ-031(底部留白)的根因①也是 `estimateSize:104` 虚高;F3 改滚动平均会**部分缓解** REQ-031 根因①,但不覆盖 REQ-031 的 measureElement 重测触发(根因②③) | spec 明确边界:F3 只做"滚动平均 estimateSize",**不动 measureElement 重测策略**(那是 REQ-031 的活);REQ-031 实施时把 F3 的 estimateSize 作为已落地基线,在其上继续 |
| 极端长会话(几百条)首帧在底后,回流期间上方历史消息测量造成可见漂移 | F3 正是压这个;若仍不够,再上 F3b(per-index 高度缓存)或 F2(稳定前遮罩,本次不做) |
| `useLayoutEffect` 阻塞绘制 | `scrollTop` 赋值是 O(1),RAF 异步,不阻塞;且 `:380` 同模式已在生产 |
| F3 measureElement wrapper 重复计数导致平均失真 | WeakSet 跟踪已计元素 / ResizeObserver;plan 阶段定机制并加单测 |
| 自动滚底 effect 加 gate 后,新会话首条流式响应不贴底 | 初始 RAF 在流式期间持续运行(pendingInitialScrollRef 仍 true)会贴底;RAF 收尾后 gate 放行,`:740` effect 接管——两段都贴底,无缝 |
| 改了 `:740` effect gate 影响流式中途用户上滑后的行为 | gate 只在 `pendingInitialScrollRef=true`(初始锚定窗口)生效;流式中途 pending 早已 false,`isUserScrolledUp` 逻辑不受影响 |

## 10. 状态机与发版

- BACKLOG 新增 **REQ-032**,状态 `backlog` → `spec`(本 spec)。
- 类型 `fix`,按主题发版规则 → **patch**(候选 `v0.8.3`,基线为当前 `v0.8.2`;最终版本号由发版时点定)。
- 与相邻 REQ 关系:
  - **REQ-029**(已 merge)= 翻页加载更多滚位保持 —— 不冲突,不同 scroll 路径。
  - **REQ-031**(ready)= 底部留白 —— 共享 `estimateSize` 改动面,F3 为其铺部分地基;实施顺序建议 **REQ-032 先**(本 spec 范围小、低风险),REQ-031 在其上继续。
