---
REQ-ID: REQ-045
title: 侧边栏项目行 a11y/嵌套修复(div onClick→button + 解 Button 嵌套 + 键盘可达)
date: 2026-07-26
status: spec
关联: BACKLOG REQ-045(kimi 分析);dogfood A2A 委派 kimi 侧边栏第 1 条(最优先)
---

# REQ-045 侧边栏项目行 a11y/嵌套修复设计

## 背景

`src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx` 渲染侧边栏单个项目行(桌面端 `md:flex` 分支,L250–378)。当前结构:

```
<Button variant="ghost" onClick={selectAndToggleProject}>   // 外层 <button>
  <div onClick={toggleStarProject}> ... </div>                // star   (L262)
  ... (displayName / sessionCount / input 编辑态)
  <div onClick={saveProjectName}> ... </div>                  // save   (L329)
  <div onClick={onCancelEditingProject}> ... </div>           // cancel (L338)
  <div onClick={onStartEditingProject}> ... </div>            // rename (L350)
  <div onClick={onDeleteProject}> ... </div>                  // delete (L360)
</Button>
```

外层是 shadcn `<Button>`(渲染成原生 `<button>`),内部 5 个操作用 `<div onClick>` 模拟按钮。移动端分支(`md:hidden`,L119–248)已是合法 `<button>`,**不在本次范围**。

## 问题(4 类)

### P1 — HTML 非法嵌套(`<button>` 嵌 `<button>` 不允许,但实际是 div-in-button,核心问题是下面的 a11y 与键盘)

HTML 规范不允许 `<button>` 内嵌 `<button>`。此处内层是 `<div onClick>` —— 虽不触发"button-in-button"字面违规,但 `<div onClick>` 本身就是反模式:它不是 interactive element,缺语义角色、缺键盘激活、缺焦点环。这是 4 类问题的共同根因。

### P2 — 键盘 Tab 不可达

5 个操作 `<div onClick>` 没有 `tabIndex`,键盘用户 Tab 只能到外层 Button,**永远到不了** star/save/cancel/rename/delete。完全鼠标依赖。

### P3 — 读屏不识别

`<div onClick>` 对辅助技术是"generic group",读屏不播报"按钮"、不播报用途。虽有 `title=` 属性(star/rename/delete 有),但 `title` 不是 accessible name 的可靠来源,且 save/cancel 连 `title` 都没有。

### P4 — `stopPropagation` 跨浏览器不一致(真功能 bug,非纯 a11y)

每个内层 `<div onClick>` 都 `event.stopPropagation()` 防冒泡到外层 Button 的 `selectAndToggleProject`。但 `<div>` 上的 click 事件传播行为(尤其合成事件 + 焦点切换)在不同浏览器/输入法下不一致,已 dogfood 观察到偶发"点 star 却折叠了项目"的穿透。改成原生 `<button>` 后,click 语义稳定,`stopPropagation` 行为可预期。

## 目标

桌面端项目行:
1. 外层仍是"可点击切换/选中项目"的可聚焦单元,但不再是嵌套 `<button>`。
2. 5 个操作改成原生 `<button>`,键盘 Tab 可达,Enter/Space 激活。
3. 读屏播报每个操作的用途(accessible name)。
4. 操作按钮的 hover 显隐同时响应键盘焦点(`focus-within`),键盘用户能看到。
5. 选中态对辅助技术可见(`aria-current`)。
6. 视觉零回归 —— 所有 className / 间距 / 颜色 / 动效保持现状。
7. 所有现有 onClick 行为(含 `stopPropagation`)**保留**。

## 范围

### 改
- **仅** `src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx` 的桌面端分支(L250–378)。
- 外层 `<Button variant="ghost" onClick={selectAndToggleProject}>` → `<div role="button" tabIndex={0} aria-current={isSelected || undefined} onKeyDown>`。
- 5 处 `<div onClick>` → `<button type="button" aria-label={t(...)}>`(用现有 i18n key,见下)。
- hover 显隐类 `group-hover:opacity-100` 处加 `focus-within:opacity-100`(键盘焦点也能唤出 rename/delete)。

### 不改
- 移动端分支(`md:hidden`,L119–248)—— 已是合法 `<button>`,无嵌套问题。
- `SidebarProjectSessions.tsx` / `SidebarSessionItem.tsx` 等同目录文件 —— kimi 第 2/3 条提及的"同步修复"经核查:SessionItem 已用原生 `<button>`,无需改;本 spec 不扩散。
- handler 签名(`selectAndToggleProject` / `toggleStarProject` / `saveProjectName` / `onCancelEditingProject` / `onStartEditingProject` / `onDeleteProject`)—— 全部保留,只换承载它们的 DOM。
- i18n locale 文件 —— aria-label 全部复用现有 `tooltips.*` key(7 种语言已齐)。

## 改法(逐处)

### 外层(L250–260,378)

```
<Button variant="ghost" className={cn(...)} onClick={selectAndToggleProject}>
  ...
</Button>
```
→
```
<div
  role="button"
  tabIndex={0}
  aria-current={isSelected ? 'true' : undefined}
  className={cn(...)}   // 原 className 原样保留(variant="ghost" 的视觉已在该 className 里)
  onClick={selectAndToggleProject}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAndToggleProject();
    }
  }}
>
  ...
</div>
```

说明:
- `role="button"` + `tabIndex={0}` 让外层仍是可聚焦/可激活的"项目行按钮",对读屏是 button。
- `aria-current="true"`(仅选中态)让读屏播报"当前项目"。
- Enter / Space 触发 `selectAndToggleProject`,与原生 button 默认行为对齐。`e.preventDefault()` 防 Space 滚动页面。
- 原 `variant="ghost"` 的视觉(`hover:bg-accent/50` 等)已在 className 里,直接保留即可;不再需要 shadcn Button。
- 删除文件顶部 `import { Button } from '../../../../shared/view/ui';`(桌面端是该文件唯一 Button 使用点)。

### star(L262–283)

`<div onClick={...} title={isStarred ? removeFromFavorites : addToFavorites}>` →
`<button type="button" aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')} onClick={...} className={cn(...原类)}>`。
保留 `event.stopPropagation()`。原 `title` 可保留(双保险,鼠标 hover tooltip),也可删 —— **保留**,零回归。

### save(L329–337)

`<div onClick={saveProjectName}>` → `<button type="button" aria-label={t('tooltips.save')} onClick={...}>`。保留 stopPropagation。

### cancel(L338–346)

`<div onClick={onCancelEditingProject}>` → `<button type="button" aria-label={t('tooltips.cancel')} onClick={...}>`。保留 stopPropagation。

### rename(L350–359)

`<div onClick={onStartEditingProject} title={t('tooltips.renameProject')}>` → `<button type="button" aria-label={t('tooltips.renameProject')} onClick={...}>`。
hover 显隐类:`opacity-0 ... group-hover:opacity-100` → 加 `focus-within:opacity-100`。
**注意**:此按钮获得焦点时,外层 role=button 也在 tab 序列 —— rename 按钮是 tab 链上的下一站,合理(用户 Tab 进项目行 → 再 Tab 到 rename)。

### delete(L360–369)

同 rename,改 `<button>`,aria-label 用 `t('tooltips.deleteProject)`,hover 类加 `focus-within:opacity-100`。

### i18n key 映射(全部已存在于 `src/i18n/locales/*/sidebar.json` 的 `tooltips` 区)

| 操作 | key | en 值 |
|---|---|---|
| star(add) | `tooltips.addToFavorites` | "Add to favorites" |
| star(remove) | `tooltips.removeFromFavorites` | "Remove from favorites" |
| save | `tooltips.save` | "Save" |
| cancel | `tooltips.cancel` | "Cancel" |
| rename | `tooltips.renameProject` | "Rename project (F2)" |
| delete | `tooltips.deleteProject` | "Remove project from sidebar (Delete)" |

## 验收标准

1. **键盘可达**:Tab 顺序 = 外层项目行 → (rename / delete 显隐后) → star → save/cancel(编辑态)。每个操作 Enter/Space 能触发对应 handler(对照原 onClick 行为)。
2. **读屏播报**:NVDA/VoiceOver 聚焦每个按钮时播报其 accessible name(Add to favorites / Rename project / ...)。
3. **无点击穿透**:点 star/save/cancel/rename/delete 不触发外层 `selectAndToggleProject`(项目不意外折叠/切换)。stopPropagation 保留。
4. **键盘可见性**:Tab 到 rename/delete 时按钮显现(不再因 `opacity-0` 而不可见)。
5. **选中态可读**:选中项目行,读屏播报 "current"(aria-current=true)。
6. **视觉零回归**:与改前对照,桌面端项目行的间距、颜色、hover/active 动效、star 颜色、编辑态 input 样式全部一致。
7. **类型/构建**:`npm run typecheck`(双 tsconfig)过;`git diff --check` 无空白错误。
8. **文件卫生**:`SidebarProjectItem.tsx` 改后 ≤ 500 行(改前 407,预计 +20 行左右)。

## 风险与回退

- **风险低**:纯展示层重构,handler 不变。i18n key 复用,无新增 locale。
- **唯一注意点**:外层从 `<button>` 变 `<div role=button>`,某些 CSS reset 对 `button` 的默认样式(如 `border`/`background`)不再施加 —— 但本组件 className 已显式设全(`hidden md:flex w-full justify-between p-2 ...`),不依赖 button 默认样式。视觉应零变化。
- **回退**:单文件 revert 即可。

## 不做的事(out of scope)

- 移动端分支重构(已合规)。
- `SidebarSessionItem.tsx` 等其他侧边栏子组件(kimi 第 2/3 条建议经核查非必要,SessionItem 已用原生 button)。
- 给 save/cancel 加 tooltip title(aria-label 已够;title 是鼠标提示,非必需)。
- 新增 i18n key。
