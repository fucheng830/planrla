---
REQ-ID: REQ-031
标题: 对话底部留白(已解决:消息内容溢出测量盒子 → spacer overflow:clip)
日期: 2026-07-13
状态: ✅ 已解决(landed main `0d70ca0`,2026-07-13)
类型: fix
---

> **✅ 解决摘要**:根因 = 消息内容的 trailing margin/绝对定位子元素**溢出测量盒子**;`getTotalSize` 只算 `offsetHeight`(不含 margin),浏览器却把溢出计入 `scrollHeight` → spacer 下方大片可滚空白。**virtualizer 全程无辜**(诊断:所有 item `inflation=0`)。修法 = spacer 加 `overflow:'clip'`(`ChatMessagesPane.tsx:303`,commit `2446ba3`,merge `0d70ca0`)。Archie 实测留白消失。详见 [工作文件](../work/REQ-031-progress.md) 的「解决记录」。下文为调查过程留存。

# REQ-031 对话底部留白

> ⚠️ **本 spec 写于调查中途**。2026-07-13 的三项实测(re-mount / 会话长度 / DOM 检查)**推翻了原 BACKLOG 的核心假设**("virtualizer `getTotalSize` 虚高")。残留留白的根因**尚未最终坐实**,实施前必须完成最后一项确认(§4)。本文档把已确认的认知、已排除的方向、和当前最可疑的方向都固化下来,避免下次从零起。

## 1. 背景(症状 + 原假设)

**原始症状**(Archie 2026-07-08 截图,Web 端 `.13:5173`):对话最后一条消息与底部输入框之间出现约 **40-50% 屏高**的大片留白,右侧滚动条未到底(滚动区看似比真实内容高)。

**原 BACKLOG 假设**(2026-07-08):`ChatMessagesPane.tsx` 用 `@tanstack/react-virtual`,`estimateSize:()=>104` 初估每条 104px,`getTotalSize()` 撑开滚动区,`measureElement` 异步测真实高度。三个候选根因:
- ① `estimateSize`(104)对短消息虚高,measure 未跟上时 `getTotalSize()` > 真实内容 → 底部留白;
- ② 已测消息高度事后变化(工具展开/折叠、代码块/Markdown 懒渲染、图片加载、streaming 增长)未触发 re-measure → 缓存尺寸漂移、累计虚高;
- ③ 是否为刚 merge 的 REQ-029 scroll RAF 回归。

**F3(REQ-032,2026-07-11)的顺带效果**:`estimateSize` 改"已测高度滚动平均"后,留白从 **40-50% 降到 ~10-15%**(spec 预言的"缓解根因①"应验)。残留 ~10-15%(≈80-150px)是本次要治的。

## 2. 2026-07-13 调查(三项实测)

### 2.1 re-mount 测试(Archie)→ 推翻根因②
末条消息**滚出视口再滚回**(让 item 卸载重挂、`measureElement` 重测),留白**不消失**。
→ 若是 stale 已测尺寸(②),re-mount 重测应纠正。没纠正 ⇒ **不是简单的 stale 缓存尺寸**。

### 2.2 会话长度确认(Archie)→ 推翻"短会话顶对齐"
留白出现在**长会话(足几屏)**,不是内容不足一屏的短会话顶对齐留底空。
→ 排除"scroll 容器内 spacer < clientHeight、顶对齐留底"假设。

### 2.3 DOM 实测(Archie 提供完整 HTML)→ **推翻原核心假设**
对一条 93 条消息、当前显示末 15 条的会话,scroll 容器内:
- **spacer 高 = `getTotalSize()` = 2968px**
- 15 个 item(data-index 0–14);各 item 的 `translateY`(= 累计缓存尺寸):
  - item 0–13:`0 → 109 → 168 → 240 → … → 897px`,平均 **~64px/条** —— 思考区/工具区都**正确折叠成 ~0 高度**(`grid-rows-[0fr]` + 子元素 `overflow-hidden` 生效)
  - **item 14(最后一条,带大量表格 + KaTeX + 几千字的最终回答)起始 897px → slot = 2968 − 897 = 2071px**
- **`getTotalSize(2968) = items 0–13(897)+ item 14(2071)`。sum 完全对得上。**

**结论:`virtualizer` 没有虚高。** spacer 反映的是真实内容高度(最后那条超长回答本身就该 ~2071px)。**原 BACKLOG 的核心假设"virtualizer `getTotalSize` 虚高"在本次实测里不成立。**

## 3. 当前认知:残留留白不在 spacer 层,在某条消息内部

由 §2 可知:spacer 几何正确、折叠区正确折叠、re-mount 不消。残留的 ~10-15%(~100px)留白**只可能来自某条消息内部"测出来高、肉眼看不到"的内容**——即 `offsetHeight` 包含、但视觉为空/被裁的高占用。

**最可疑:item 14 的 KaTeX 渲染。** 该消息含大量数学公式,DOM 里多处出现 `<span class="katex-error">`(KaTeX 解析错误占位)。错误占位 / 未渲染数学 / async 渲染时序,可能让消息**测出来 ~2071px、肉眼内容 ~1971px**,差 ~100px = 残留留白。

## 4. ⚠️ 实施前必做:坐实根因(最后一项确认)

`点进那片留白区域本身`(不是消息、不是 scroll 容器,就点那片空白),看 DevTools 高亮的元素 + height。三种可能,一看便知:

| 高亮元素 | 根因 | 修法方向 |
|---|---|---|
| `<span class="katex-error">` / 空 `<div>` / 折叠区子元素 | **消息内部渲染占高**(KaTeX 错误 / 空元素 / 折叠区未真折) | 改 `Markdown.tsx` / `MessageComponent.tsx` / 折叠 CSS(候选 A/C) |
| spacer / scroll 容器,且 `scrollHeight > clientHeight` 但滚不到底 | 滚动定位问题(锚定没到真底) | 复查 REQ-032 F1a 锚定 + auto-scroll effect |
| composer(输入框)的上边距 / 内部空区 | composer 布局,与聊天区无关 | 改 `ChatComposer.tsx` 布局 |

**不确认就动手 = 可能误改 virtualizer(已证无辜)或改错地方。** 这一步 10 秒,必须做。

## 5. 目标 / 非目标

**目标**:
- 对话底部残留留白 **< 2% 屏高**(即只剩正常 padding ~12-16px,肉眼无感)。
- 长/短会话、含 KaTeX / 代码块 / 工具结果的消息,滚到底无虚高。

**非目标**:
- ❌ 不改 virtualizer 选型、`estimateSize` 策略、分页模型(实测 spacer 没虚高,virtualizer 无辜;F3 的滚动平均保留)。
- ❌ 不重做消息折叠动画 / KaTeX 渲染管线本身(只修"占高"这个点)。
- ❌ 不动 REQ-032 的 scroll 锚定(F1a/F1b/F3 全保留,本需求不得让其回归)。

## 6. 候选修法(预案,视 §4 根因定,不在此锁定)

> 根因未坐实前,以下均为预案,不在本 spec 锁定具体修法。

- **候选 A(KaTeX-error 占高)**:`Markdown.tsx` 的 KaTeX 错误处理 —— 把 error 占位从"块级 reserve 高度"改成"inline 小标记不占块高度",或对 error 回退到纯文本(不挂 `.katex-error` 块)。
- **候选 B(async 渲染测高时序)**:消息挂载后 KaTeX / markdown / syntax-highlight 异步完成,`measureElement` 初始测的是 pre-async(偏高)状态。加 **debounced 强制重测**:内容挂载/settle 后 ~300-500ms 调一次 `virtualizer.measure()`(或对渲染中的消息单独重测)。⚠️ 关键区别:这不同于 re-mount(re-mount 测在 mount 瞬间,早于 async 完成,故 §2.1 不消);debounced 重测在 async **完成后**,能捕获真实高度。
- **候选 C(折叠区未真折叠)**:给 `grid-rows-[0fr]` 的子元素加 `min-h-0` 保险(防个别浏览器把 grid track min 解析成 min-content),确保折叠区真 0 高度。**注意**:本次 DOM 实测显示 items 0–13 已正确折叠(~64px),故 C 大概率不是根因,除非特定消息类型的折叠失效。

## 7. 影响面 / 文件(pending 根因)

| 文件 | 可能改动(视根因) |
|---|---|
| `src/components/chat/view/subcomponents/Markdown.tsx` | 候选 A:KaTeX error 占高处理 |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` | 候选 A/C:消息内部空元素 / 折叠区 |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` | 候选 B:debounced `virtualizer.measure()` 触发点(**不动** virtualizer 配置本身) |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | 仅当 §4 根因是 composer 布局 |
| **不动** | `useChatSessionState.ts` scroll 逻辑、virtualizer 选型 / `estimateSize` / 分页模型、REQ-032 全部 |

## 8. 验收标准

1. 对话底部留白 **< 2% 屏高**(仅正常 padding)。
2. **长会话**(>100 条,含代码 / KaTeX / 长 tool diff)滚到底无虚高。
3. **短会话**(1-3 条)点进无底部留白(此项需复查 §4 是否同时存在短会话顶对齐问题;若有两类则分开治)。
4. 工具结果展开/折叠后高度即时收敛、无残留空白。
5. **不回归**:REQ-029 翻页位置保持、REQ-032 初始锚定 + 流式贴底、搜索跳转。
6. `npm run typecheck && npm run build` 干净。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| **根因未最终确认**:本 spec 写于调查中途,re-mount / 长度 / DOM 三项测试推翻了原假设但未坐实新根因 | §4 的"点进留白看元素"是实施前置条件,不做不实施;根因若与预案不符,回到本 spec 修订 §3/§6 |
| 候选 B(debounced 重测)可能引入滚动抖动(重测触发 layout shift,破坏 REQ-032 锚定) | 若走 B,必须验证:重测时不破坏 F1a 首帧锚定、不触发可见跳动;必要时只在"非初始锚定窗口"重测 |
| 候选 A 改 KaTeX error 渲染,可能影响 REQ-027 diff 评论复制等依赖 Markdown 的功能 | 改 `Markdown.tsx` 需回归 diff 评论 / 代码块复制 / JSON 检测 |
| BACKLOG REQ-031 四要素的"根因"段已过时(原"virtualizer 虚高"被推翻) | 本 spec §2-3 取代之;BACKLOG 条目由 Archie 在下次提交时按本 spec 更新(不在此 spec 改 BACKLOG) |

## 10. 状态机与发版

- BACKLOG REQ-031 状态 `ready` → `spec`(本 spec)。
- 类型 `fix` → **patch**(候选 v0.8.4,基线 v0.8.3;最终版本号由发版时点定)。
- 与相邻 REQ 关系:
  - **REQ-032**(已 released)= 初始滚动冲底 —— 本需求**不动**其 scroll 锚定,F3 的 `estimateSize` 滚动平均保留(实测对白边是净正向)。
  - **REQ-029**(已 released)= 翻页滚位保持 —— 本需求**不动**。
  - **若根因确为 §4 的 KaTeX/消息内部**,则 REQ-031 实际改的是消息渲染层,与 virtualizer 无关 —— BACKLOG 标题可相应改名("对话底部留白"→"消息内部 KaTeX/空元素占高")。
