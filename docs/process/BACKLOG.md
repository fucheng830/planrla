# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | 来源 | spec | plan | 版本
> `来源` 取值见 [FEEDBACK_TRIAGE.md](./FEEDBACK_TRIAGE.md):self / user:discord / user:issue#N / user:hosted / data / align:<竞品> / churn。**新 REQ 必填,历史 released 不溯。**
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped / **parked**(暂搁,不进近期队列) / **superseded**(方案被新 REQ 取代)

> **2026-07-18 SSOT 校正**(交叉 `git tag --contains` + `git log main..<branch>` + specs/plans 盘点):
> ① REQ-020 A2A **S1 已合 main**(`e15acb9`,代码在 `server/modules/a2a/`)→ spec→review;
> ② REQ-009 **已深做 17 commits**(RequirementsView + REQ-014 入口)在 `feat/req009-requirements`,未入 main → backlog→doing;
> ③ REQ-005 **spec+plan 齐全**在 `feat/provider-diag`(4 commits 纯文档,0 实现)→ backlog→plan;
> ④ REQ-029/031/032 **已发版**(v0.8.3 / v0.8.4)且方案被 **REQ-041 virtua 取代** → 标 superseded,清 Ready 区僵尸;
> ⑤ REQ-038/039 **漏录补登**(皆 spec,分支 0 commits;039 疑被 041 取代);
> ⑥ REQ-030 spec 断链(req029→req030)修复 + Ready 区撞号僵尸清除;
> ⑦ REQ-028「第 6 provider」→「第 7」(Kimi 已第 6,随 v0.8.6)。

## In Progress(在做 / 待验收)
| ID | 标题 | 里程碑 | P | 类型 | 状态 | 来源 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|------|
| REQ-020 | A2A 双向节点(Google 标准,S1 client→S2 server→S3 内部→S4 派生) | v0.8.7 | P2 | feat | released | self | S1 [spec](../superpowers/specs/2026-07-11-req020-a2a-s1-client-tools-design.md) | [plan](../superpowers/plans/2026-07-17-req020-a2a-s1.md) | **S1+S2+S3+S4 全合 main,四切片完整**;S1 client(c57bd7e)/ S2 inbound(ddafb46)/ S3 内部协作(52c34b5)/ S4 派生(94b30d2);loopback only |
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | — | P1 | feat | doing | self | _(分支内)_ | _(分支内)_ | **`feat/req009-requirements` 17 commits 未入 main**:RequirementsView + REQ-014 sidebar 右键「新需求」入口 + NewRequirementModal。含子 REQ-014(已并入此分支)/ REQ-019(Kanban 维度待澄清)。见 `PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md` |
| REQ-030 | AI 自动重命名(10 轮触发 + 守卫长度修复) | v0.10.0 | P2 | feat | released | self | [spec](../superpowers/specs/2026-07-11-req030-ai-auto-rename-design.md) | [plan](../superpowers/plans/2026-07-11-req030-ai-auto-rename.md) | `feat/req030-auto-rename` 9 commits(Task 7 review),未入 main |
| REQ-040 | 状态校验工具 check-req-status(状态机↔git 自动绑定) | v0.9 | P1 | feat | review | self | [spec](../superpowers/specs/2026-07-16-req040-status-git-binding-design.md) | [plan](../superpowers/plans/2026-07-16-req040-status-git-binding.md) | `a476b7b` 在 main,待三道门验收 |
| REQ-027 | UX 对齐 Codex · 渲染层交互(① diff 高亮 + ② plan 展示 + ④ diff 评论) | — | P1 | feat | review | align:codex | [spec](../superpowers/specs/2026-07-08-req027-ux-align-codex-design.md) | [plan](../superpowers/plans/2026-07-08-req027-ux-align-codex.md) | 随 v0.8.0 发,待验收置 accepted |
| REQ-045 | 侧边栏项目行 a11y/嵌套修复(div onClick→button + 解 Button 嵌套) | v0.10.0 | P2 | fix | released | self | _(kimi 分析即 spec)_ | _(待写)_ | dogfood A2A 委派 kimi 分析侧边栏给的第 1 条(最优先)。`src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx` 外层 `<Button>`(L250)内嵌 5 个 `<div onClick>`(star L262/保存 L329/取消 L338/rename L350/delete L360)→ HTML 非法嵌套(button in button)+键盘 Tab 不可达+读屏不识别+`stopPropagation` 跨浏览器不一致(真功能 bug)。**改法**:① 外层 Button→`<div role="button" tabIndex={0} onKeyDown>`;② 5 处 div→`<button type="button" aria-label>`;③ hover 改 `focus-within:opacity-100`;④ 选中态加 `aria-current`(并入 kimi 第 3 条)。**验收**:键盘 Tab 达每个操作 + 读屏播报 + 无点击穿透 + 视觉无回归。 |
| REQ-046 | 后台任务管理面板(统一列表:kanban/a2a/chat/agent Bash) | v0.11.0 | P1 | feat | released | self | [spec](../superpowers/specs/2026-07-27-bg-task-panel-design.md) | _(待写)_ | server `background-task-registry` 聚合四类后台任务 + 前端 `BackgroundTaskPanel`(方案 A 统一列表)+ agent Bash 解析 SDK tool_use events(方案 1+ 启发式完成态)+ 顺带修 REQ-034 aux flags 实时。直击 quant #3 后台管理混乱(孤儿/乱杀)。详见 spec。
| REQ-047 | 侧边栏 Markdown 文档编辑器(手动 + AI 辅助,对标 Codex) | v0.11.0 | P2 | feat | released | self | [2026-07-28-req047-md-editor-design](../superpowers/specs/2026-07-28-req047-md-editor-design.md) | _(待写)_ | **背景**:Codex 新功能(@gengdaJ 帖 2026-07-28)——侧边栏直接编辑 .md,手动 + AI 编辑(选段让 agent 改,3-5s),用户不再切 Obsidian/VSCode。planrla 流程全是 .md(spec/plan/BACKLOG/release/README/docs),改这些得切外部编辑器,上下文断。**目标**:侧边栏 .md 编辑面板:浏览项目 .md 树 + CodeMirror md 编辑(源码/预览)+ AI 辅助(选段 silent agent 改,复用 REQ-030/046 silent 通道 + stopTask,≤5s)+ 保存。**范围**:侧边栏新面板(portal,同 BackgroundTaskPanel)+ .md 浏览(项目树/最近)+ CodeMirror md 复用(chat 代码块已在)+ preview + AI 选段改(silent chat.send + 写回)+ server 文件 API(GET/PUT /api/files)。**验收**:打开 .md + 编辑(源码/预览)+ AI 选段改(≤5s,inline)+ 保存落盘;不破坏 chat/sidebar。
| REQ-044 | A2A 错误处理两缺陷(middleware 把 400 藏成匿名 500 + a2a_call metadata 位置) | v0.10.0 | P1 | fix | released | self | _(快修)_ | _(快修)_ | **真实根因(纠正前期误判)**:前期疑 spawn try 外抛,实测**正斜杠路径 spawn 完全跑通**(kimi 2+2 回 "4" 23s;sidebar UI 分析 111s)→ spawn 代码无 bug,createAppSession/startRun 一直正确(诊断脚本早证明)。真因:① 客户端发坏 JSON(Windows 反斜杠 `D:\..` 在 `metadata.projectPath` 序列化时变成非法转义)→ body-parser `JSON.parse` 抛 SyntaxError(`statusCode:400`, `type:'entity.parse.failed'`)→ **全局 middleware(`server/index.js:1641`)只认 `AppError`,SyntaxError 落入匿名 `500 INTERNAL_ERROR`**,错误信息全丢 → 诊断地狱(误为 spawn bug 误查 ~40 工具调用)。② A2A `metadata.projectPath` 对 Windows 反斜杠路径不健壮。**范围**:① middleware 透传带 `statusCode` 的非 AppError 错误(已改 server/index.js,+11 行);② **a2a_call MCP 失败根因已定位 + 修复中**:`a2a-client.service.ts:312 buildSendPayload` 把 spawn/provider/projectPath 放 `params.message.metadata`,但 `inbound.service.ts` handleTaskSend 读 `params.metadata`(顶层)→ 不匹配 → spawn 不触发 → `metadata.sessionId required` failed 静默无 log。curl 工作因手写 body 放了顶层 `params.metadata`。**修复**:buildSendPayload 把 spawn/provider/projectPath 移到 `params.metadata`(A2A spec:task 级 metadata 在 SendTaskParams.metadata,message 级在 Message.metadata);③ 已回滚误改的 spawn try 扩大(inbound.service.ts 基于不存在前提)。 |

| REQ-048 | 看板创建任务 404(taskTemplateId 找不到→错误信息丢 message+模板不同步) | v0.11.0 | P1 | fix | released | self | _(快修)_ | _(快修)_ | **根因已定位**(hub 实测 dev server 3001):`POST /api/tasks` → `service.createTask` 第一步 `requireTemplate(taskTemplateId)`(service.ts:40 / :323-326),模板在磁盘 `~/.planrla/kanban-templates/` 找不到时抛 `TASK_TEMPLATE_NOT_FOUND` statusCode **404** → 路由 `res.status(e.statusCode??500)` 透传 404(kanban.routes.ts:137)→ 前端裸报 `createTask failed: 404`。路由挂载/proxy/认证全健康(缺 token 返 401 非 404),kanban 路由非近期回归。磁盘当前仅 2 模板(dogfood-goal/fe-dev-pipeline)。三处缺陷:① `api.ts createTask` 丢 body.message(对比 parsePrd/submitReview 都读);② `KanbanContext.createTask` 失败不 reloadTemplates;③ `CreateTaskDialog` tplId=useState(templates[0]?.id) 只 mount 一次,不跟随 templates 变化。**派 Kimi 改**(worktree `feat/req048-kanban-create-404`)。 |
| REQ-049 | 对话 fork(从当前对话分支新对话,对标 Codex /fork) | v0.11.0 | P2 | feat | released | align:codex | [spec](../superpowers/specs/2026-07-29-req049-fork-conversation-design.md) | _(待写)_ | **背景**:Codex `/fork`(app/desktop)+ `codex fork --last`(CLI)复制 session history 到新 thread_id,用户强烈要(issue #9499 fork current / #14024 fork at message)。planrla 用户同样要「从当前对话分支新对话」:不想丢原对话又想试另一条思路。**目标**:点 fork → 复制当前对话全历史 → 新 session → 自动切到新对话;原对话完全不变。**范围**:① server `POST /api/providers/sessions/:sessionId/fork`(stream copy jsonl + DB 新行 + null provider_session_id + jsonl_path 指向副本);② `sessionsService.fetchHistory` 分叉:`provider_session_id IS NULL && jsonl_path 已设` 时直接读副本(provider 读法扩 jsonl_path 入参);③ 前端 sidebar session 项 hover 操作组加 fork 按钮(GitBranch icon,Edit 旁)+ 调 fork API → onNavigateToSession(newId)。详见 spec。**验收草稿**:① fork 后新对话历史 = 原对话副本;② 原对话任何字段/历史不变;③ 新对话首条消息走新 provider session(resume:false);④ 大对话流式复制不爆内存;⑤ typecheck + 既有测试不回归。 |
| REQ-052 | 会话压缩归档(压缩后主视图只显压缩后上下文,历史进「历史消息查询」) | — | P1 | feat | spec | self | [spec](../superpowers/specs/2026-08-28-req052-compact-archive-design.md) | _(待写)_ | 长会话对话太多渲染/加载问题:方案 A 虚拟边界(JSONL `isCompactSummary` 行 + SDK `compact_boundary` 事件)+ `fetchHistory` 增 view 口径(active/archived/all,默认 all 零回归)+ 归档查询视图按纪元分页;P1 sidecar 快照抗 CLI 清理。**复盘遗留(2026-08-29,合并前已修 4 项:缓存表接读路径+差异化写+剪枝、live 缓冲清理按 session 过滤)**:①全局搜索命中归档段跳转降级(主视图 view=active 无目标→静默滚最近时间戳)且「加载全部」语义已变为当前纪元全部;②`archivedMessages` tri-state(null=惰性)契约需类型注释钉死(验收已踩一次 count>0);③live compact_boundary 的 trigger/preTokens 落库(upsert COALESCE 已预留,无生产者);④CLI 清理检测提示(基准表有数据无消费 UI);⑤live refetch 400ms 与 CLI flush 竞态待 dogfood 验证 |
| REQ-053 | 令牌按钮 hover 详情卡片 + 点击自动压缩上下文(仿 /compact) | v0.15.0 | P2 | feat | spec | self | [spec](../superpowers/specs/2026-08-28-req052-token-usage-compact-design.md) | _(待写)_ | **背景**:聊天输入框令牌按钮点击弹 `/cost` 模态,详情重交互;长会话无一键压缩入口,用户得切 CLI 手敲 /compact。**目标**:hover ≥150ms 浮出详情卡片(总 token/输入输出拆分/上下文占用比/可见消息数,蓝白对齐命令面板),移开即消失;点击按钮 = 触发当前会话自动压缩(claude CLI /compact 语义),按钮 loading,完成用量刷新;`/cost` 斜杠命令保留。**范围**:前端 `TokenUsageSummary.tsx` 重构(portal popover)+ 压缩状态链路;服务端 WS 新增 `chat.compact`(复用 per-turn query,prompt='/compact')+ 能力矩阵 `supportsCompact`(claude true,其余「暂不支持」提示);i18n zh-CN/en。**验收草稿**:① hover popover 出现/消失 + 四项数据 + 提示文案;② 点击触发压缩,loading 起止正确,完成后摘要消息与用量刷新;③ 不支持 provider 显示暂不支持;④ tsc + eslint 0 error;⑤ playwright 无头截图留存 `debug/ui-acceptance/`;⑥ spike 证 headless `/compact` 生效。**注**:原 REQ-052 号被压缩归档需求占用,本行编号顺延为 REQ-053(代码内部注释保留 REQ-052 原号,不影响功能) |

### REQ-048 四要素
- **背景**:dogfood 实测「看板创建任务」报 `createTask failed: 404`。hub 实测当前 dev server(3001)`POST /api/tasks` 直连/经 vite 均正常(缺 token 返 401),路由挂载/proxy/认证全健康,kanban 路由非近期回归(最后 `1ed6a8e` task-master 退役)。**根因**=`service.createTask`→`requireTemplate(taskTemplateId)`(service.ts:323-326)在磁盘 `~/.planrla/kanban-templates/` 找不到该 id 时抛 `TASK_TEMPLATE_NOT_FOUND` 404 → 路由 `res.status(e.statusCode??500)` 透传 404。磁盘当前仅 2 模板(dogfood-goal/fe-dev-pipeline)。前端 templates 与后端不同步(WS 只同步 tasks 不同步 templates)+ tplId 只取 mount 一次 → 用过期 id 创建即 404,且错误是裸 404 用户无法理解。
- **目标**:创建任务时模板找不到,给可读错误(`template xxx not found`)而非裸 404;前端 createTask 失败自动同步模板列表;tplId 跟随实际 templates 不用过期 id。
- **范围**:① `src/components/kanban/api.ts` `createTask` 读 `body.message`(对齐 parsePrd/submitReview 写法);② `src/components/kanban/KanbanContext.tsx` `createTask` catch 块失败时调 `reloadTemplates()` 同步;③ `src/components/kanban/CreateTaskDialog.tsx` `tplId` 跟随 `templates[0]?.id`(useMemo/受控默认,避免过期 id)。仅这 3 文件,不动后端(后端 404 语义正确)。
- **验收草稿**:① 用后端不存在的 templateId 创建 → 错误提示「template xxx not found」(非裸 404);② 模板被删后前端 createTask 失败自动刷新 templates 下拉;③ CreateTaskDialog 打开时 tplId 恒等于当前 templates[0] 实际 id;④ `npm run typecheck` 过 + 既有 kanban 测试不回归。
- **来源**:self(dogfood 实测 + hub 代码层定位)。

### REQ-052 四要素
- **背景**:对话历史直接读 Claude JSONL(整读+整归一化,首屏切尾 20 条);压缩(compact)后摘要行 `isCompactSummary:true` 追加、原始行仍留文件里,压缩前历史照样整读整渲染——长会话「对话太多」卡。SDK 的 `compact_boundary` 事件现被归一化层静默丢弃。
- **目标**:压缩触发事件(live+历史双通道);主视图默认只渲染最后一个边界后的消息(摘要渲染为压缩卡);边界前历史进「历史消息查询」按纪元分页查看;主视图开销从 O(全会话) 收敛到 O(当前纪元)。
- **范围**:types 增 `compact_boundary` kind + `view` 口径;claude provider 边界识别(raw 文件顺序)与 active/archived 分支;routes 增 `view/epoch` + `GET …/compactions`;`session_compactions` 缓存表;前端 view=active + realtime 清槽换血 + 压缩卡 + ArchiveMessagesPanel(UI 组件 A2A 委托 Kimi)。默认 all,kanban digest / session-query MCP / REQ-049 fork 零回归。
- **验收草稿**:① compact 后主视图只剩边界后消息,重进亦然,`hasMore` 在纪元起点截断;② 历史入口按纪元翻页可见全部旧消息,不影响主视图;③ 既有长会话打开即生效零迁移;④ 默认 REST 行为不变,MCP/digest/fork 测试锁定;⑤ 大会话首屏响应体收敛 + typecheck/测试过。
- **来源**:self(渲染性能诉求,kanban task #4)。

### REQ-049 四要素
- **背景**:Codex `/fork`(桌面 + `codex fork --last` CLI)复制 session `history.jsonl` → 新 `thread_id` session;社区两 issue(#9499 fork current / #14024 fork at message)证明刚需。planrla 用户跑长对话想「试另一条思路但不丢原对话」,当前只能复制粘贴或新建空对话重述背景,上下文断。**本版范围 = 整体 fork**(全历史复制);fork at message(at point)第二阶段不做。
- **目标**:在 sidebar session 项点 fork 按钮 → 后端流式复制原对话 jsonl + 建 DB 新行 → 前端自动切到新对话(历史 = 原对话副本);**原对话任何字段/历史/文件零变化**(fork = copy,不是 move)。
- **范围**:① server `POST /api/providers/sessions/:sessionId/fork`(`sessions.service.ts` 加 `forkSession`,流式 `fsp.copyFile` 原 jsonl_path → 同目录 `<uuid>.jsonl` 副本 + DB `createAppSession` 新行 + 更新 `jsonl_path` 指副本 + `custom_name = "<原标题> · fork"`);② `sessionsDb` 加 `updateSessionJsonlPath`;③ `sessionsService.fetchHistory` 分叉:当前 `provider_session_id IS NULL` 直接返空,改为 `NULL && jsonl_path 已设` 时走 provider 的「按 jsonl_path 直读」分支(provider sessions 读法扩 `jsonlPath` 入参,claude/codex/gemini/cursor/opencode/kimi 至少 claude 实现,其余 fallback 空历史不报错);④ 前端 `src/stores/useSessionStore.ts` 加 `forkSession`(调 API)+ `SidebarSessionItem.tsx` hover 操作组加 fork 按钮(GitBranch,Edit 前)+ 调 store.forkSession → 拿新 id → `onForked(newId)` 回调由上层 navigate;⑤ i18n zh-CN/en `tooltips.forkSession`。不动 chat 顶栏(无现成顶栏组件,改 chat 风险大,fork 入口集中在 sidebar)。
- **验收草稿**:① fork 后新对话打开历史 = 原对话全消息副本;② fork 前后原对话 custom_name / provider_session_id / jsonl_path / 消息 全不变;③ 新对话 `provider_session_id` 初始 null,首条消息后 provider runtime 新建 provider session(resume:false);④ 100MB jsonl fork 流式复制不爆内存(copyFile,非 readFile);⑤ `npm run typecheck` 过 + 新增 fork 测试通过 + 既有 sessions/sidebar 测试不回归。
- **来源**:align:codex(`/fork` 对标)。

## Ready(四要素齐,待规格化)
| ID | 标题 | P | 类型 | 状态 | 来源 |
|----|------|----|------|------|------|
| REQ-037 | kanban agent stage 无超时,偶发挂死(prompt 后静默) | P1 | fix | ready | self |
| REQ-034 | kanban aux flags 不实时更新(agent 进度 UI 不可见) | P1 | fix | ready | self |
| REQ-036 | kanban worktree HEAD 与 task.worktreeBranch 不一致 | P3 | fix | ready(降级) | self |

### REQ-037 四要素
- **背景**:dogfood task 3/4(agent stage)prompt 后零产出零 event,静默挂死。**根因(经 task 5 确认)= GLM 代理**:planrla server 继承环境 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`(GLM 代理)+ `DEFAULT_*_MODEL_NAME=glm-5.x`,`claude-sdk.js:160` 把 `...process.env` 全传给 SDK → spawn 的 claude CLI 走 GLM → **GLM 对工具密集的 agent 任务(tsc+test+MCP task_next)塌方挂死**(参见 memory [[planrla-glm-proxy-tool-failure-rootcause]])。task 1/2(简单镜像)勉强能跑;task 3/4(4 阶段+tsc+MCP)塌。**task 5 重启 server 清 GLM env 后,4 阶段流水线完整跑通(success)**,100% 确认根因。`claude-sdk.js:692` for-await 无超时只是放大症状。
- **目标**:agent stage 不因 GLM/代理塌方而静默挂死;agent 任务走真 Anthropic(不继承宿主 GLM env);挂死有超时兜底 + aux.sessionError 可见。
- **范围**:① **spawn env 剖离 GLM**——`mapCliOptionsToSDK` 的 `sdkOptions.env` 不传 `ANTHROPIC_BASE_URL`/`DEFAULT_*_MODEL_NAME`(或为 agent 配独立真 Anthropic key),主 chat 保留 GLM;② **runner stage 超时兜底**(`Promise.race` 默认 10min → abort + `updateTaskAuxFlags({sessionError:'stage timeout'})` + task fail + worktree 清理);③ CLI 子进程 stderr 捕获到 server 日志。推荐 ①+②。
- **验收草稿**:① 在 GLM 代理环境下建 agent 任务 → 不挂(agent 走真 Anthropic);② 模拟 spawn 不 yield → stage 超时触发 → task fail + worktree 释放 + aux.sessionError='stage timeout';③ 主 chat 仍走 GLM(剖离只影响 agent);④ server 日志含挂起子进程 stderr。

### REQ-034 四要素
- **背景**:dogfood 实测——agent 全程在 worktree 写码 + commit,但 `task.auxFlags` 全程全 false、`updatedAt` 卡在建任务时刻,UI 徽章看不到任何进度。根因:`runner.spawnFn = queryClaudeSDK`(进程内 claude SDK),SDK 的 events(thinking / tool_use / TodoWrite / Plan)没经 `RunnerWriter` → `auxBridge` 桥接到 `task.auxFlags`。
- **目标**:agent 执行过程中 auxFlags(hasPlan/hasTodos/hasTask/askUserWaiting/sessionError)实时反映;UI 徽章 + updatedAt 随 agent 事件推进。
- **范围**:主改 `runner-writer.ts` + `aux-bridge.ts` + `claude-sdk.js` 的 event emit/转发。对照 MindFS `appcontext.go:805-869` aux 桥接。不改 store schema(aux 列已在)。先实测确认 queryClaudeSDK 是否 emit events、writer 是否接。
- **验收草稿**:① 建 agent 任务,跑过程中 UI aux 徽章实时变化(TodoWrite→hasTodos 亮、出错→sessionError 亮);② `task.updatedAt` 随事件推进;③ 既有测试不回归。

### REQ-036 四要素
- **背景**:dogfood task 1 疑 worktree 实际 HEAD=main 与 task.worktreeBranch 不一致;task 2/3 两次未复现。
- **目标**:worktree HEAD 与 task.worktreeBranch 恒一致。
- **范围**:`worktree-setup.ts` 的 `git worktree add` 命令(`-b <branch> <base>` 构造)+ 排查 agent 执行中是否 checkout 别处。
- **验收草稿**:① 建任务后 `git -C worktree branch --show-current == task.worktreeBranch`;② agent commit 后 HEAD 仍在 branch、working tree 含改动。
- **来源**:self(dogfood 实测)。**降级 P3**:2 次未复现,疑 agent 偶发 checkout,非系统性。

## Spec / Plan 就绪,待执行
| ID | 标题 | P | 状态 | 来源 | 备注 |
|----|------|----|------|------|------|
| REQ-005 | Provider 诊断面板 | P1 | plan | self | spec + plan 齐在 `feat/provider-diag` 分支(4 commits 纯文档,0 实现);待派 subagent。M3 里程碑 |
| REQ-038 | kanban pending reply(待回复状态/提醒) | — | spec | self | [spec](../superpowers/specs/2026-07-14-req038-kanban-pending-reply-design.md);`feat/req038-kanban-pending-reply` 占位(0 commits),待 writing-plans |

## Backlog(待细化)
| ID | 标题 | P | 类型 | 状态 | 来源 | 备注 |
|----|------|----|------|------|------|------|
| REQ-021 | UX 对齐 Codex 母项(动效 + 网页/图片预览 + 交互优化) | P1 | feat | backlog | align:codex | 独立 UX 专项,可先行;REQ-027 是其首切片(在 review);母项 REQ-022 parked |
| REQ-028 | Grok Build CLI provider(SuperGrok 订阅 OAuth) | P2 | feat | backlog | self | **第 7 个 provider**(Kimi 已第 6,随 v0.8.6);[spike](../design-drafts/req028-supergrok-xai-oauth-spike.md) 方向 v2:走 CLI agent provider(仿 opencode spawn,非 http 异类);官方 OAuth 干净;⚠️ tier 403 + streaming-json schema 待实测 |

## Parked(暂搁,不进近期队列)
| ID | 标题 | 来源 | 搁置原因 |
|----|------|------|----------|
| REQ-006 | License 试用/离线授权 | self | 商业化,等核心锁型(M6) |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | self | 商业化,等核心锁型(M6) |
| REQ-015 | 跨对话上下文共享(母,L2/L3/C3/C4 后续阶段) | self | 首切片 REQ-016 已发;母剩余阶段待排 |
| REQ-022 | 对齐 Codex 全特性集(母) | align:codex | 需先 Codex 特性审计 → Archie 标优先级,再拆子 REQ;UX 子集已拆 REQ-021/027 |

## Blocked(冻结/待想清楚)
| ID | 标题 | P | 类型 | 状态 | 冻结原因 |
|----|------|---|------|------|----------|
| _(暂无)_ | | | | | |

## Released / Superseded
| ID | 标题 | 版本 | spec | 备注 |
|----|------|------|------|------|
| REQ-051 | Android 侧边栏 web UI 对齐 + 桌面端切换迁移 + Kimi stream_delta | v0.14.0 | _(追溯录,无 spec)_ | 22 commit:侧边栏图标/头部/列表/空状态/logo(PNG 替 Canvas)对齐 web 卡片风格;桌面端切换迁侧边栏底部(Material 图标替 emoji);Kimi 完整回复切 stream_delta;登录卡片填满(之前窄留白 UI 问题);多个 fix。stream-text 抽取进行中未进本版 |
| REQ-050 | ZCode (Z.AI) provider(第 8 个 provider) | v0.12.0 | _(追溯录,无 spec)_ | zcode-cli.js 桥 + 7 个 provider 模块(list/zcode/)+ ZcodeLogo;session-query/a2a MCP 跳过(ZCode 不允许外部改配置)。ZCode 实现在 v0.11.1 tag 之后,语义 minor 故发 v0.12.0 |
| REQ-043 | kanban goal-stop-hook(stage 级 /goal 式自主) | v0.9.0 | [spec](../superpowers/specs/2026-07-22-req043-kanban-goal-stop-hook-design.md) · [plan](../superpowers/plans/2026-07-22-req043-kanban-goal-stop-hook.md) | Stop hook 顶层 `{decision:'block'}` + task_complete MCP + maxTurns(默认 300)兜底;catch-all matcher(spike 证 glob 不命中 MCP 全名);`2fc2021` 合 main;typecheck + 208/208 + final review 可合并 |
| REQ-041 | 聊天列表迁移 virtua 消除翻页抖动 | v0.8.6 | [spec](../superpowers/specs/2026-07-17-req041-virtua-migration-design.md) · [plan](../superpowers/plans/2026-07-17-req041-virtua-migration.md) | 根因 react-virtual 异步 measureElement 两次 commit,补偿层(RAF/RO/批次)全证伪;改 virtua VList 同帧补偿。Archie electron 已验。**取代 REQ-029/031/032** |
| REQ-029 | loadEarlier 翻页 scroll RAF 补偿 | v0.8.3 | _(plan `2026-07-10-req029-scroll-raf.md`)_ | ⚰️ **superseded**:方案(RAF 补偿)被 REQ-041 证伪取代 |
| REQ-031 | 对话底部大片留白(virtualizer 高度虚高) | v0.8.4 | [spec](../superpowers/specs/2026-07-13-req031-chat-bottom-whitespace-design.md) | ⚰️ **superseded**:被 REQ-041 virtua 取代 |
| REQ-032 | 消除初始滚动冲底(F1 首帧锚定 + F3 estimateSize 滚动平均) | v0.8.3 | [spec](../superpowers/specs/2026-07-11-req032-chat-initial-scroll-rush-design.md) | ⚰️ **superseded**:被 REQ-041 virtua 取代 |
| REQ-039 | chat render perf | _(未发版)_ | [spec](../superpowers/specs/2026-07-16-req039-chat-render-perf-design.md) | ⚰️ **superseded**:方案被 REQ-041 virtua 取代(分支 0 commits 占位);`feat/req039-perf` 可删 |
| REQ-035 | kanban worktree 装 node_modules(junction) | v0.8.3 | _(dogfood `d5af7fe` + task 5 实测;含 removeWorktree inverse)_ | |
| REQ-016 | 跨会话上下文 MCP 定点查询 + 全局搜索(L2+L3) | v0.8.0 | [spec](../superpowers/specs/2026-07-08-req016-mcp-query-design.md) | L2 `query_session` + L3 `search_conversations`(FTS5)+ `/search` 命令 + 结果卡片 |
| REQ-013 | 会话重命名(chat 触发 MCP 工具) | v0.8.0 | [spec](../superpowers/specs/2026-07-09-req013-session-rename-chat-mcp-design.md) | |
| REQ-026 | Sessions 切换按钮去双徽标(只留 completed 计数) | v0.7.1 | _(ad-hoc)_ | |
| REQ-024 | 合并「对话」与 Running sessions 侧边栏视图 | v0.7.0 | [spec](../superpowers/specs/2026-07-06-merge-chat-running-sessions-design.md) | |
| REQ-025 | 侧边栏状态 UI 统一(Projects / Sessions / 搜索) | v0.7.0 | [spec](../superpowers/specs/2026-07-07-req025-sidebar-status-ui-unify-design.md) | |
| REQ-023 | 桌面端外链系统浏览器打开 | v0.6.2 | [spec](../superpowers/specs/2026-07-06-external-link-handling-design.md) | accepted(已发,从 In Progress 移入) |
| REQ-011 | 桌面端自动更新(Tasks 1-9,含 e2e) | v0.6.0/v0.6.1 | [spec](../superpowers/specs/2026-07-03-req011-auto-update-design.md) | v0.6.0→v0.6.1 升级 e2e 实测通过;R2 更新源 live |
| REQ-018 | 桌面端 i18n 完整改造 + Android UI 修复 + 云设备管理 | v0.5.0 | _(ad-hoc 7716098)_ | 80 文件 +1944/-699 |
| REQ-017 | Linux headless server Docker 镜像(server-only) | v0.5.0 | _(ad-hoc 36bf31f)_ | |
| REQ-008 | Android 多主机扫描/管理 | ~v0.5.0 | _(已核对:HostScanner.kt 真实现)_ | |
| REQ-012 | 桌面 native ABI 修复(sync-native-abi + npmRebuild=false) | v0.4.1 | _(ad-hoc dfaf4be)_ | |
| REQ-002 | 文件树增量加载 + react-window 虚拟化 | v0.4.0 | _(feat/file-tree-v2 破例直发)_ | |
| REQ-010 | 桌面打包模式禁用 restartRequired 误报 | v0.3.0 | [spec](../superpowers/specs/2026-07-02-req010-restart-required-fix-design.md) | |
| REQ-001 | 官网落地页(Cloudflare Pages + release feed) | v0.3.0 | [spec](../superpowers/specs/2026-07-02-landing-page-design.md) | |
| REQ-000 | 桌面端三态主题(system/light/dark) | v0.2.0 | _(未走本流程)_ | |
| REQ-004 | WebSocket 消息节流/合并 | main(M2) | _(M2-C ws-batch 覆盖:`2e64af3`)_ | |
| REQ-003 | 会话列表分页/缓存 | main(M2) | _(M2-D projects-perf 覆盖:batched SQL + N+1 消除)_ | |

> 注:v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 已含的其他完成项(桌面体验默认值 / 自绘标题栏 / 三态主题 UI / fr i18n / 项目性能优化 / 发版流程基建)未逐条回填 BACKLOG,见 CHANGELOG.md 与 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。
