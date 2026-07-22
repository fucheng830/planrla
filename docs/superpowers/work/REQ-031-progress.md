# REQ-031 工作管理文件 — 对话底部留白

> **状态**:✅ **已解决**(2026-07-13,修复合入 main `0d70ca0`)| **spec**:[2026-07-13-req031-chat-bottom-whitespace-design.md](../specs/2026-07-13-req031-chat-bottom-whitespace-design.md)
> **根因**:消息内容的 trailing margin / 绝对定位子元素**溢出测量盒子**;virtualizer 的 `getTotalSize` 只累加 `offsetHeight`(不含 margin),但浏览器把这截溢出计入 `scrollHeight` → spacer 下方出现大片可滚空白(~948px)。**virtualizer 全程无辜**(诊断:所有 item inflation=0)。
> **修法**:`ChatMessagesPane.tsx` 的 spacer div 加 `overflow:'clip'`,裁掉溢出。用 `clip` 而非 `hidden`:不创建滚动上下文,不破坏展开工具区的 sticky 表头。
> **验证**:Archie 在 .13 实测,留白消失。`.13` 网络抖动(连不上 github)暂未切回 main,但 `feat/req031-whitespace @ 2446ba3` = 同一份修复,已生效。

---

## ✅ 解决记录

- **诊断坐实**:live DOM 诊断显示所有 item `inflation=0`(virtualizer 无辜),`scrollH(6739) >> spacerH(5791)`,差 ~948px 在 spacer 下方;`overflow:hidden` 一行测试 → 留白消失 → 确认是 spacer 内部内容溢出测量盒子。
- **修复**:`overflow:'clip'` on spacer(`ChatMessagesPane.tsx:303`)。commit `2446ba3`,merge `0d70ca0` 入 main。
- **清理**:临时 merge worktree、`feat/req031-whitespace`、`feat/req031-investigate` 分支 + worktree 全清;远端两分支已删。
- **遗留**:
  - `.13` git 连不上 github(SSL_ERROR_SYSCALL,网络层),待恢复后 `git checkout main && git pull` 切 canonical。
  - `feat/req031-chat-bottom-whitespace`(在 `.worktree/kanban/...`)是**并行另一 session** 建的同主题分支(基于 19bc5fe,无本修复)——他们合 main 时以 main 为准(本修复已 in main)。
  - BACKLOG REQ-031 状态应置 `accepted`/`released`,但 BACKLOG 是 Archie 在制品(脏树),未改。

---

## 0. 一句话现状

原 BACKLOG 假设"virtualizer `getTotalSize` 虚高"已被 DOM 实测**推翻**(spacer = 真实内容之和)。残留 ~10-15% 留白**不在 spacer 层**,最可能在**末条消息内部**(async 渲染测高时序)。**根因坐实只差一步**:跑下面的诊断脚本(§3),数出来即定。

---

## 1. 进度日志

- **2026-07-08**:Archie 截图报告底部 40-50% 留白 → BACKLOG REQ-031 入池,原假设 virtualizer 虚高(三候选:① estimate ② stale ③ REQ-029 回归)。
- **2026-07-11**:REQ-032 F3(estimateSize 滚动平均)顺带把留白从 40-50% 降到 ~10-15%。
- **2026-07-13 早**:三项实测——
  - re-mount 不消 → 推翻 ② stale
  - 长会话 → 推翻"短会话顶对齐"
  - DOM 实测 spacer=2968 = items 0–13(897,正确折叠)+ item 14(2071,超长回答)→ **推翻 virtualizer 虚高核心假设**
- **2026-07-13(本自动推进)**:
  - 写 spec([2026-07-13-req031-...-design.md](../specs/2026-07-13-req031-chat-bottom-whitespace-design.md))
  - 读 `Collapsible.tsx` / `Reasoning.tsx` / `main.jsx` / `Markdown.tsx` 代码 → 排除候选 C(折叠正确)、减弱候选 A(KaTeX-error 在折叠区,不在可见末条)
  - 写本工作管理文件 + 一键诊断脚本(§3)+ 候选预案(§4)
  - **未实施任何代码改动**(根因未确认,不冒险误改)

---

## 2. 已确认认知(代码 + DOM)

| 项 | 结论 | 证据 |
|---|---|---|
| virtualizer spacer | **没虚高** | DOM: `getTotalSize(2968) = items 0–13(897) + item 14(2071)` |
| items 0–13 折叠 | **正确(~64px/条)** | DOM translateY: 0→109→…→897;`Collapsible.tsx` 标准 `grid-rows-[0fr]`+`overflow-hidden` 生效 |
| KaTeX-error 位置 | **在折叠思考区里**(items 7/10/13),不在可见末条 | DOM: item 14 的 KaTeX 是 `.katex-html`(正常渲染),非 `.katex-error` |
| re-mount 是否消留白 | **不消** | Archie 实测 → 排除"一次性 stale" |
| 残留留白量 | ~10-15% 屏高(≈80-150px) | Archie 截图 |

**推论**:残留留白 = 末条(item 14)的**缓存 slot(2071px)> 真实 offsetHeight**,差 ~100px。最可能机制:item 14 的内容(代码高亮 Prism + KaTeX)async 渲染后**收缩**,而 `measureElement` 初始测在收缩前;ResizeObserver 理论上该捕获收缩但显然没(否则 re-mount 后会消)。**待 §3 诊断脚本确认。**

---

## 3. ⭐ 根因确认:一键诊断脚本(Archie 醒后跑)

**用法**:打开有留白的那个会话(.13:5173 或任意能复现的),DevTools → Console,粘贴下面整段,回车。看输出 + 自动判读。

```js
(() => {
  const log = (...a) => console.log('[REQ-031]', ...a);
  const scroll = document.querySelector('.relative.flex-1.overflow-y-auto');
  if (!scroll) { log('❌ 没找到 scroll 容器(.relative.flex-1.overflow-y-auto)'); return; }
  const spacer = [...scroll.children].find(c => c.style.position === 'relative' && c.style.height);
  if (!spacer) { log('❌ 没找到 spacer'); return; }
  const spacerH = parseInt(spacer.style.height);
  const items = [...spacer.children].filter(c => c.hasAttribute('data-index'));
  const rows = items.map((el, i) => {
    const idx = +el.getAttribute('data-index');
    const m = (el.style.transform || '').match(/translateY\(([\d.]+)px\)/);
    const start = m ? +m[1] : null;
    return { el, idx, start, offsetH: el.offsetHeight };
  });
  rows.forEach((r, i) => {
    const nextStart = i + 1 < rows.length ? rows[i + 1].start : spacerH;
    r.cachedSlot = Math.round(nextStart - r.start);
    r.inflation = Math.round(r.cachedSlot - r.offsetH);
  });
  log('=== per-item(inflation>0 = cached>真实 = stale)===');
  console.table(rows.map(r => ({ idx: r.idx, start: Math.round(r.start), cachedSlot: r.cachedSlot, real: Math.round(r.offsetH), inflation: r.inflation })));
  const totalInflation = rows.reduce((s, r) => s + r.inflation, 0);
  log('总 inflation:', totalInflation, 'px');
  log('=== scroll 位置 ===');
  log('scrollTop=', Math.round(scroll.scrollTop), 'scrollHeight=', Math.round(scroll.scrollHeight), 'clientHeight=', scroll.clientHeight);
  const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
  log('到底?', atBottom);
  const last = rows[rows.length - 1];
  if (last && last.inflation > 5) {
    log(`=== 末条 item[idx=${last.idx}] inflation=${last.inflation}px → 直接子元素 ===`);
    [...last.el.children].forEach((c, i) => log(`  [${i}] <${c.tagName.toLowerCase()} class="${(c.className||'').toString().slice(0,60)}"> offsetH=${c.offsetHeight}`));
    log('  末条内 offsetHeight 最大的 5 个后代(定位占高元素):');
    [...last.el.querySelectorAll('*')].map(e => ({e, h: e.offsetHeight})).sort((a,b)=>b.h-a.h).slice(0,5).forEach(({e,h}) => log(`    h=${h} <${e.tagName.toLowerCase()} class="${(e.className||'').toString().slice(0,50)}">`));
  }
  log('=== 全局 ===');
  log('katex-error 数:', scroll.querySelectorAll('.katex-error').length);
  const next = scroll.nextElementSibling;
  if (next) log('scroll→composer 间隙:', Math.round(next.getBoundingClientRect().top - scroll.getBoundingClientRect().bottom), 'px');
  log('=== 自动判读 ===');
  if (totalInflation > 20) log(`👉 spacer 富余 ${totalInflation}px → 根因=item 测高 stale/async → 走候选 B`);
  else if (!atBottom) log('👉 item 正常但没到底 → 根因=滚动定位 → 复查 REQ-032 锚定');
  else log('👉 item 正常 + 已到底 → 留白来自别处(composer 布局/容器 padding/视错觉)');
})();
```

**三种判读结果 → 对应根因 + 候选**:

| 脚本输出 | 根因 | 走哪个候选 |
|---|---|---|
| `总 inflation > 20px`(末条 inflation 大) | item 测高 stale(async 渲染收缩未重测) | **候选 B**(debounced forced re-measure) |
| `item 正常但没到底` | 滚动没锚到真底 | 复查 REQ-032 F1a 锚定(scroll 定位问题,非 REQ-031 范畴) |
| `item 正常 + 已到底` | composer 布局 / 容器 padding / 视错觉 | 改 `ChatComposer` 或确认是正常 padding,可能不用改 |

把脚本输出(尤其 `console.table` 那张表 + 自动判读那行)发给我就行。

---

## 4. 候选修法预案(待 §3 锁定,ready-to-apply)

### 候选 B —— forced re-measure(最可能命中,API 已确认)
**触发条件**:§3 输出 `总 inflation > 20px`。
**原理**:末条内容(Prism 代码高亮 / KaTeX)async 渲染后收缩,`measureElement` 初始测在收缩前;ResizeObserver 理论上该捕获收缩但显然没(否则 re-mount 后会消)。强制重测 → 捕获真实高度。
**API 已确认**(`@tanstack/virtual-core@3.14.5`,`node_modules/.../index.d.ts`):
- `virtualizer.measure()`(L1093):清 `itemSizeCache` + `notify`(触发 re-render)。**但注意**:它只清缓存,**不会让已挂载 item 的 ref 回调重跑**(ref 只在挂载/卸载触发)——清完后已挂载 item 会临时回退到 `estimateSize`,且若不 resize 就不会再被测,可能不收敛。所以单纯 `measure()` 可能不够。
- `virtualizer.measureElement(el)`(L823):对单个 el 重测(即使已挂载,手动调一次会重跑 `resizeItem`)。
- `virtualizer.resizeItem(index, size)`(L826):手动设某 item 尺寸(若我侧算出真实尺寸可直接灌)。
**实施机制(plan 阶段定,二选一)**:
- B1:debounced effect 在内容 settle 后,遍历已挂载 item 的 DOM,逐个调 `virtualizer.measureElement(el)` 重测。
- B2:用 `getBoundingClientRect` 算出真实高度,调 `resizeItem(index, real)` 精确灌。
**改哪里**:`src/components/chat/view/subcomponents/ChatMessagesPane.tsx`(加 debounced effect / 改 `measureAndTrack`;**不动** virtualizer 配置)。
**风险**:重测可能触发 layout shift → 必须验证不破坏 REQ-032 F1a 首帧锚定;必要时只在 `!pendingInitialScrollRef.current`(非初始锚定窗口)重测。

### 候选 A —— KaTeX error 占高(已减弱,概率低)
**触发条件**:§3 末条子元素里有 `.katex-error` 占块高(但代码读 + DOM 看,item 14 的 KaTeX 是正常渲染,此候选概率低)。
**改哪里**:`src/components/chat/view/subcomponents/Markdown.tsx` —— `rehypeKatex` 配置加 `throwOnError: false`(出错渲染原文本不占块)或自定义 error 回退。

### 候选 C —— 折叠区 min-h-0(已排除)
DOM 实测折叠正确(~64px/条),`Collapsible.tsx` 用标准模式。**不做。**

### 候选 D —— 滚动定位(若 §3 判读"没到底")
**触发条件**:§3 输出 `item 正常但没到底`。
**说明**:这不是 REQ-031(virtualizer/消息),是 REQ-032 F1a 锚定没到真底(spacer 虚高时 scrollTop=scrollHeight-clientHeight 落在空隙里)。需要复查 F1a。**归 REQ-032 复查,非 REQ-031。**

---

## 5. Archie 醒后确认清单(按顺序)

1. **跑 §3 诊断脚本**(在有留白的会话,DevTools Console 粘贴),把输出(表 + 自动判读)发我。—— **这是唯一阻塞项,10 秒。**
2. 根据判读结果,我锁定候选(A/B/D 之一)。
3. 我建 `feat/req031-whitespace` worktree,走 writing-plans → 实施 → 两阶段 review(同 REQ-032 流程)。
4. 验收:留白 <2% 屏高 + 不回归 REQ-029/032。

---

## 6. 本会话自动推进产出清单

- ✅ spec:`docs/superpowers/specs/2026-07-13-req031-chat-bottom-whitespace-design.md`
- ✅ 本工作管理文件(进度 + 诊断脚本 + 候选预案)
- ✅ 代码深化调查:排除候选 C、减弱候选 A,聚焦候选 B(async 测高时序)
- ⏸ **未动代码**(根因未确认,不冒险)
- ⏸ 待 Archie 跑 §3 诊断

## 7. 待清理

- `feat/req031-investigate` 分支(origin + 之前的 console.log 诊断 worktree):**已被本文件 §3 的 paste-in-console 脚本取代**,可删(`git push origin --delete feat/req031-investigate` + 本地 worktree remove)。低优先,Archie 方便时清理。
