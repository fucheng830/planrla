# kanban task #2 验证记录——可视化验证截图留证

任务:41cae793-9e19-48c4-8bf1-5e771395fae8 · 阶段:测试验证 · 日期:2026-08-28
本任务改动涉及 UI(DeliverablePanel 渲染方式)→ 按新固化的模板要求执行 playwright 截图留证。

## 1. 命令验证

| 验证项 | 命令 | 结果 |
|---|---|---|
| server 类型检查 | `npx tsc --noEmit -p server/tsconfig.json` | PASS(exit 0) |
| web 类型检查 | `npx tsc --noEmit -p tsconfig.json` | PASS(exit 0) |
| eslint(全部改动文件) | `npx eslint <10 个改动/新增文件>` | 0 errors(12 warnings 均为存量 import-x/order,基线相同) |
| kanban 模块测试 | 4 个测试文件(sdlc-default-template / delivery-doc / prompt / template-routes) | 40/40 PASS |
| 全量 server 套件 | `npm test` | 441/445 PASS;4 个失败(projectsDb.createProjectPath、createProject conflict、providerMcpService×2)经 git stash 基线复跑确认为**存量失败**,与本次改动无关 |

<details><summary>原始输出摘录</summary>

```
== tsc server ==
PASS (exit 0)

== tsc web ==
PASS (exit 0)

== eslint (changed files) ==
✖ 12 problems (0 errors, 12 warnings)
eslint exit: 0 (0 errors, warnings are pre-existing import order)

# tests 40
# pass 40
# fail 0
```

</details>

> 注:完整原始输出曾存 `debug/verification-task2.log`,因仓库 `.gitignore` 的 `*.log` 规则不入库,本地保留。

## 2. 模板迁移对已有磁盘模板环境生效(实测)

环境:本机真实 `~/.planrla/kanban-templates/task_template-sdlc-default.json`(2026-08-26 由旧版 seed 写入,无 seedVersion 字段 = v1)。

| 步骤 | 结果 |
|---|---|
| 迁移前 dry-run(`migrateSdlcDefaultSeed`,不写回) | 首跑暴露 ss4 为 `{input}` **单括号历史变体**,被指纹跳过 → 据此修复:`V1_PROMPTS` 改为变体数组(commit 26fc453) |
| 修复后 dry-run | `upgraded: ['ss3','ss4'], skipped: []`,两条 prompt 均含 `debug/ui-acceptance/` |
| 真实启动(worktree dev server,SERVER_PORT=3210)触发启动迁移 | 磁盘文件更新:`seedVersion: 2`,ss3/ss4 均为新文案(截图规则可见),迁移日志 `upgraded: ss3,ss4; kept user edits: none` |
| 幂等 | 再次启动无重复迁移日志 |

## 3. renderStagePrompt 渲染「测试验证」阶段可见截图要求

单测断言(`tests/prompt.test.ts`):v2 ss3 snapshot 经 `renderStagePrompt` 渲染产物含 `可视化验证要求(强制)`、`debug/ui-acceptance/`、`playwright`,且 `{{task_number}}` 替换为具体编号(`task7-hover-popover.png`),MCP preamble 完整。

## 4. 可视化验证(playwright 无头截图,本任务自身 dogfood)

方式:真实起 dev 环境(worktree server :3210 + vite :5180,共享真实用户库只读),`debug/capture-task2-ui.mjs` 无头 chromium 注入本地 JWT 后操作真实页面。验收「交付面板渲染截图」复用任务 #1(REQ-052,success)真实现场:临时向其 DELIVERY.md 注入 markdown 图片语法,断言图片加载完成后截图,`finally` 中 git 原文还原(已复核还原干净)。

断言:`.ds-panel img` 元素 `complete && naturalWidth > 0`(真实经 `/api/providers/local-image` 代理加载,非占位)。

| 截图(debug/ui-acceptance/) | 证据点 |
|---|---|
| `task2-app-loaded.png` | 真实 app 登录态加载 |
| `task2-workflow-page.png` | 研发流程看板正常渲染 |
| `task2-delivery-panel-table-ref.png` | 任务 #1 面板:DELIVERY.md 的表格文字引用**原样保留不误改**(Markdown 渲染生效) |
| `task2-delivery-panel-image.png` | 注入图片语法后面板渲染 DELIVERY.md(标题/排版渲染生效) |
| `task2-delivery-evidence-image.png` | **核心**:「验证证据」小节下 req052-popover.png 截图在面板内真实渲染(hover 弹层可见) |

截图脚本(留存 debug/,可复跑):
- `debug/capture-task2-ui.mjs` — 主场景(上表前 4 张)
- `debug/capture-task2-detail.mjs` — 滚动特写(第 5 张)
- `debug/task2-e2e-fixture.mjs` + `debug/capture-task2-deliverable-panel.mjs` — 备用路径:隔离 fixture(独立 DATABASE_PATH,不碰真实数据)方案

### 失败与重试记录(按模板要求说明)

- vite 以 `npx vite` 启动报「系统无法执行指定的程序」→ 改 `node node_modules/vite/bin/vite.js` 直调解决;
- vite/tsx 在沙箱 stdin EOF 时自动退出 → `tail -f /dev/null |` 保持 stdin 常开解决;
- 首轮选择器 `getByText('工作流')` 超时 → rail 为纯图标按钮(`aria-label`),改 `getByRole('button', { name: '研发流程' })` 解决;
- `networkidle` 因 vite HMR ws 永不达成 → 改 `domcontentloaded` + 固定等待解决。

### 未覆盖项说明

模板编辑器(TaskTemplateEditor)UI 内查看 ss3 新文案的截图未产出:入口在右侧扩展面板 kanban tab(动态新 tab 菜单),无稳定直达选择器,best-effort 跳过。该项证据由替代层覆盖:磁盘文件级(seedVersion=2 + ss3 文案)、API 级(GET /tasks/templates)、单测 40/40——均为强证据,不影响验收判定。

## 5. 截图清单(供交付阶段写入 DELIVERY.md)

```
debug/ui-acceptance/task2-app-loaded.png
debug/ui-acceptance/task2-workflow-page.png
debug/ui-acceptance/task2-delivery-panel-table-ref.png
debug/ui-acceptance/task2-delivery-panel-image.png
debug/ui-acceptance/task2-delivery-evidence-image.png
```
