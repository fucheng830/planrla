# 交付说明:可视化验证必须截图留证(模板固化 + 磁盘迁移 + 交付面板渲染)

> kanban task #2(`41cae793-9e19-48c4-8bf1-5e771395fae8`)
> 分支:`kanban/2-41cae793`(基于 main)· 日期:2026-08-28
> 技术方案:`docs/design/2026-08-28-kanban-ui-screenshot-evidence-design.md`

## 一、完成内容

为研发流程增加「可视化验证必须截图留证」的工程化要求,三条需求全部落地:

### 1. 模板固化(需求 1)

- 内置 sdlc-default 模板定义从 `assembly.ts` 内联 seed 提取到新模块 **`sdlc-default-template.ts`**(单一事实源),升级为 **v2**:
  - **ss3「测试验证」**:强制约束——UI/可视化改动必须 playwright 无头真实打开页面截图留证,统一存 `debug/ui-acceptance/`(文件名含任务编号与场景,`task{{task_number}}-<场景>.png`),截图脚本留存 `debug/` 便于复跑;纯后端/逻辑改动可豁免但须声明「本任务无可视化改动」;
  - **ss4「交付」**:DELIVERY.md 必须含「验证证据」小节,用 markdown 图片语法列出全部截图相对路径(见本文件第五节,dogfood 生效)。
- **`TaskTemplate.seedVersion?: number`** 新字段(types.ts):磁盘模板 seedVersion 落后时,启动时(`assembly.ts`)执行 `migrateSdlcDefaultSeed` 定向迁移——stage prompt 仍等于 v1 原文(含 ss4 历史单括号 `{input}` 变体)才升级,用户自改的 stage 原样保留并在日志点名;迁移幂等(无条件写回最新 seedVersion)。
- **`preserveSeedVersion`**:前端模板编辑器整体 POST 保存 sdlc-default 时,服务端兜底沿用磁盘 seedVersion,防止迁移标记被抹掉导致重复迁移。

### 2. 交付说明引用(需求 2)

ss4 模板 prompt 固化「验证证据」小节要求(上文),本 DELIVERY.md 即按此模板产出。

### 3. 交付物面板渲染截图(需求 3,可选增强)

- 新模块 **`delivery-doc.ts`**:`resolveDeliveryDocImages` 把 DELIVERY.md 中**真实存在**于 worktree 的相对路径图片(`![alt](相对路径)`)改写为绝对路径——只重写 `existsSync` 通过且未跳出 worktree 的引用,缺失/外链/绝对路径原样保留(「声明了但缺失」本身是验收信号);`GET /api/tasks/:id/delivery-doc` 接线。
- **`WorkflowPage.tsx` DeliverablePanel**:`deliveryDoc` 从 `<pre>` 纯文本改为已有 `Markdown` 组件渲染(chat 同源,已带本地路径 → `/api/providers/local-image` 代理映射),验收人在面板内直接看到截图证据。

## 二、改动文件清单

| 文件 | 改动 |
|---|---|
| `server/modules/kanban/sdlc-default-template.ts` **(新)** | v2 模板定义、v1 变体指纹、`migrateSdlcDefaultSeed`、`preserveSeedVersion`(~160 行) |
| `server/modules/kanban/delivery-doc.ts` **(新)** | `resolveDeliveryDocImages`(~45 行) |
| `server/modules/kanban/types.ts` | `TaskTemplate.seedVersion?: number` |
| `server/modules/kanban/assembly.ts` | seed 改用构建函数 + 启动迁移接线 |
| `server/modules/kanban/kanban.routes.ts` | delivery-doc 图片解析接线;POST templates 保留 seedVersion |
| `src/components/workbench/pages/WorkflowPage.tsx` | deliveryDoc `<pre>` → `<Markdown>` |
| `server/modules/kanban/tests/sdlc-default-template.test.ts` **(新)** | v2 文案断言 + 迁移矩阵(升级/自改跳过/幂等/单括号变体)+ preserveSeedVersion |
| `server/modules/kanban/tests/delivery-doc.test.ts` **(新)** | 解析矩阵(存在改写/缺失保留/外链与越界跳过/语法变体) |
| `server/modules/kanban/tests/prompt.test.ts` | ss3 渲染产物含截图要求 + `{{task_number}}` 替换断言 |
| `server/modules/kanban/tests/template-routes.test.ts` | seedVersion 保留断言 |
| `docs/design/2026-08-28-kanban-ui-screenshot-evidence-design.md` | 技术方案(已随方案阶段提交) |
| `debug/capture-task2-ui.mjs`、`debug/capture-task2-detail.mjs` 等 | 截图脚本(留存可复跑)+ 验证记录 + 截图(见第五节) |

## 三、使用 / 合并方式

- 验收入口:看板卡「查看交付物」打开本面板;分支 `kanban/2-41cae793` 相对主仓 diff 即全部改动。
- 合并:验收通过后「验收通过并合并」(merge --no-ff 进 main);或主 worktree 手动 `git merge --no-ff kanban/2-41cae793`。
- 合并后行为:各环境**下次启动 server 时**自动迁移磁盘 `~/.planrla/kanban-templates/task_template-sdlc-default.json`(v1 → v2;用户自改过的 stage 不动,日志会点名)。新任务从「测试验证」阶段即收到截图强制要求。
- 复跑可视化验证:`node debug/task2-e2e-fixture.mjs`(可选,隔离 fixture)或起 dev(server :3210 + vite :5180)后 `node debug/capture-task2-ui.mjs`。

## 四、遗留事项

1. 全量套件 4 个存量失败(projectsDb ×2、providerMcpService ×2)——git stash 基线确认与本任务无关,建议另立任务排查。
2. `kanban.routes.ts` 505 行,存量超 500 行卫生线(本任务增量 ~10 行);后续可拆 templates/schedules 子路由。
3. 模板编辑器(TaskTemplateEditor)内查看 v2 文案的 UI 截图未产出(入口在扩展面板 kanban tab,无稳定选择器);由磁盘文件/API/单测三层证据覆盖,详见 `debug/verification-task2.md` §4。
4. 可选增强(未做,方案 §7 风险 2):验收门硬校验(debug/ui-acceptance 非空或含豁免声明),把 prompt 软约束升级为流程硬约束。
5. BACKLOG 需补录本需求条目并置 released(REQ-ID 待分配,涉及发版时按主题定 minor/patch)。

## 五、验证证据

验证记录:`debug/verification-task2.md`(tsc×2 PASS / eslint 0 error / 相关单测 40·40 / 迁移实测 / playwright 断言)。

![真实 app 登录态加载](debug/ui-acceptance/task2-app-loaded.png)

![研发流程看板](debug/ui-acceptance/task2-workflow-page.png)

![交付面板:表格文字引用原样保留(不误伤)](debug/ui-acceptance/task2-delivery-panel-table-ref.png)

![交付面板:DELIVERY.md Markdown 渲染生效](debug/ui-acceptance/task2-delivery-panel-image.png)

![核心证据:仓库内截图在交付面板内真实渲染](debug/ui-acceptance/task2-delivery-evidence-image.png)
