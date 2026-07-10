# planrla 看板迭代设计:原生多阶段任务看板

**日期**:2026-07-11
**状态**:设计已确认,待用户审阅
**范围**:planrla v0.7.x 迭代——原生任务看板(多阶段流水线)

## 1. 背景与动机

planrla(v0.7.1,Electron + Node 的 Claude Code 等 CLI 跨端 UI)当前任务管理依赖第三方 TaskMaster AI CLI 的 GUI 封装——数据在项目 `.taskmaster/` 外部目录,planrla 无第一-class 掌控,且无 worktree 隔离、无多阶段编排、无任务-会话-worktree 关联。实地查看 TaskMaster UI 后确认体验不达标,需重做。

竞品 MindFS(a9gent/mindfs,v0.4.0)用原生多阶段任务看板 + worktree 隔离 + 四向关联,把 planrla 的会话视图降维成"单线聊天"。这是 planrla 在"项目级 AI 工作台"定位上的核心缺口。

本迭代目标:为 planrla 建立原生任务看板(多阶段流水线),直击 MindFS 的差异化优势,作为后续团队协作/商业化的基础。

## 2. 范围

### 本轮 in
- 原生任务看板(多阶段流水线,**全新 UI**,不复用 TaskMaster 的 TaskBoard)
- git worktree 隔离 + 并发执行(第一版强制开启)
- 任务模板(每阶段指定 agent/model/mode/plan_mode/预置 prompt)
- 任务-会话-worktree 三向关联
- 定时任务(内置,替代 nomad-cron 插件)
- webhook 通知 channel(notification-orchestrator 扩展)

### 本轮 out(留后续 spec)
- Relay 远程访问(本轮不做,留后续 spec 评估 Cloudflare Tunnel PoC vs 自建)
- 会话双向同步(回写 ~/.claude,信任修复,留后续 spec)
- E2EE、会话 fork
- 团队协作(channels/AI 队友,对标 Helio/Multica)
- agency 协同(planrla 作 agency 执行层)
- 商业化 Pro gating(功能落地后再 gating)

### TaskMaster 去留:并存
TaskMaster 保留为"PRD 驱动的任务拆解工具"(opt-in,条件渲染保持——装了 task-master CLI + 设置开启才显示)。原生看板作为新的默认 tab。两者通过"导入"衔接(PRD 拆解出的任务可导入原生看板执行)。TaskMaster 的 Windows 检测 bug(`which` → `task-master --version`)已在本会话修复(`server/routes/taskmaster.js:41`)。

## 3. 架构

### 3.1 模块结构(遵循 planrla 现有 `server/modules/` 约定)

```
server/modules/kanban/
  types.ts          数据模型 + 状态机常量(移植 MindFS kanban/types.go)
  store.ts          SQLite 任务表(better-sqlite3 WAL)+ JSON 模板
  scheduler.ts      per-root 去抖 + hasSlot 并发规则
  service.ts        状态机核心循环(executeTask/moveTo/runAgentStage)
  runner.ts         Runner 接口,桥接 planrla 现有 5 provider session
  git-worktree.ts   worktree 操作(simple-git)
  mcp-tools.ts      Agent 自驱 MCP 工具(task_next/task_prev/task_status)
server/routes/tasks.ts     Express 路由 + WS 广播
src/components/kanban/     前端全新 kanban UI(不复用 TaskMaster TaskBoard)
  Board.tsx               看板主视图(阶段列)
  TaskCard.tsx            任务卡
  TaskDetailModal.tsx     任务详情
  TaskTemplateEditor.tsx  模板编辑
  StageColumn.tsx         阶段列
```

### 3.2 复用 planrla 现有资产(最大优势)

- **Runner.RunAgentStage** → 调 planrla 现有 5 provider session 启动逻辑(`claude-sdk.js` / `openai-codex.js` / `cursor-cli.js` / `gemini-cli.js` / `opencode-cli.js` 的 spawn + 流式)
- **WS 广播** → 复用现有 `websocket-server`(`server/modules/websocket/services/`)
- **session** → 现有 `sessions` 表加 `task_id` 列(可空,标识会话所属任务),aux flag 桥接器靠它回流
- **5 provider 对称架构不破坏** → 看板调统一 session 接口,不感知 provider 差异(`provider-capabilities` 能力矩阵不变)
- **git routes** → 现有 19 端点可复用,新增 worktree 端点
- **DB** → 复用现有 better-sqlite3 实例(`server/modules/database/`),新增 tasks/stage_runs/task_events 表

## 4. 数据模型(移植 MindFS,Node 化)

### 4.1 实体关系

```
StageTemplate (可复用积木:agent/model/mode/prompt...)
       │ 引用(弱关联)
       ▼
TaskTemplate (1)──(N) TaskTemplateStage (带 Snapshot,值拷贝——模板改了不影响在跑的任务)
       │ 实例化(CreateTask)
       ▼
Task (1)──(N) StageRun (每次阶段切换 INSERT 新行,保留历史)
Task (1)──(N) TaskEvent (append-only 审计流)
```

### 4.2 核心实体

- **StageTemplate**:`id/name/role(user|agent)/agent/model/mode/effort/fast_service/plan_mode/prompt_template/session_reuse_policy(task_main|same_stage|always_new)/agent_can_control_stage/auto_advance`
- **TaskTemplate**:`id/name/description/max_concurrency/stages[](带 Snapshot)`
- **Task**:`id/task_number/root_id/task_template_id/current_stage_index/status/scheduler_admitted/main_session_key/create_worktree/worktree_branch_mode/worktree_branch/worktree_path/labels/aux_flags/created_at/completed_at`
- **StageRun**:`id/task_id/stage_index/stage_name/role/status/session_key/input/rendered_prompt/started_at/finished_at`
- **TaskEvent**:`id/task_id/stage_run_id/type/payload_json/created_at`
- **TaskAuxFlags**:`ask_user_waiting/has_plan/has_todos/has_task/session_error`(前端徽章用)

### 4.3 状态机

**Task**:`pending / queued / running / waiting_user / paused / success / fail / cancelled`
**Stage**:`pending / running / waiting_user / success / fail / cancelled / approved / rejected`

关键转换(CreateTask → queued/waiting_user → running → waiting_user/success/fail,以及 Next/Prev/Jump/Pause/Resume/Complete/Cancel)移植 MindFS `kanban/service.go`。

### 4.4 存储

- **任务**:复用 planrla 现有 better-sqlite3 实例(`server/modules/database/`),新增 `tasks` / `stage_runs` / `task_events` 三表。WAL 模式 + 单写连接(better-sqlite3 同步 API,替代 MindFS 的 `SetMaxOpenConns(1)`)
- **模板**:JSON 文件(人类可读可手改),放在 planrla config 目录下 `kanban-templates/` 子目录(复用现有 config 路径解析逻辑)

## 5. 关键设计决策(必须改造,不能照抄 MindFS)

| # | 决策 | 理由 |
|---|---|---|
| 1 | **worktree 放 Electron 主进程 utility process** | IO 密集 + 可能卡大仓库,不能放渲染进程;`.git/info/exclude` 写入做存在性检查 |
| 2 | **第一版强制 `CreateWorktree=true`** | 跳过 MindFS「非 worktree 串行」分支,并发简化为 `used < MaxConcurrency`,solo 密集突破先跑通,串行分支后续补 |
| 3 | **Agent 自驱改 MCP 工具** | MindFS 用 `mindfs -task N -next` CLI(Electron 做不到),改成给 Claude Code 注册 MCP 工具 `task_next(taskId)` / `task_prev` / `task_status`。第一版只支持 Claude Code provider,其他 provider 靠 UI 手动 Next |
| 4 | **better-sqlite3 + electron-rebuild + WAL** | native 模块需为 Electron 版本 rebuild;单写连接;WAL 模式 |

## 6. aux flag 桥接(agent 事件 → 看板徽章)

agent 事件类型 → kanban aux flag:
- `ToolCall(AskUser)` → `ask_user_waiting=true`
- `ToolUpdate(AskUser 完成)` → `ask_user_waiting=false`
- `ToolCall(Task 工具)` → `has_task=true`
- `PlanUpdate` → `has_plan=true`
- `TodoUpdate` → `has_todos=true`

通过 `session.taskId` 反查 task,调 `svc.UpdateTaskAuxFlags` 写库 + WS 广播。前端凭 flag 画"待答复/有计划/有TODO/有子任务"徽章。

## 7. 落地顺序(4 周密集)

| 周 | 交付 |
|---|---|
| W1 | `types.ts` + `store.ts`(SQLite 三表)+ 状态机单测(翻译 MindFS `service_test.go` 1072 行成 TS 单测) |
| W2 | `service.ts` 核心循环(不含 agent)+ `scheduler.ts`(per-root 去抖 + hasSlot)+ Express 路由(`/api/tasks/*`)+ WS 广播 |
| W3 | `runner.ts` 桥接 planrla Claude session(`claude-sdk.js`)+ aux flag 桥接 |
| W4 | worktree(simple-git + utility process)+ MCP 自驱工具(Claude Code)+ 前端全新 kanban UI + 定时任务(node-cron)+ webhook 通知 channel |

## 8. 测试策略

- **状态机单测**:翻译 MindFS `service_test.go`(1072 行)成 TS 单测,覆盖所有状态转换
- **集成测试**:worktree 创建/清理、agent 阶段执行、aux flag 桥接
- **E2E**:创建任务 → 跑 → 看板显示 → worktree 隔离 → 阶段推进
- **验证命令**:`npm run typecheck && npm test`(planrla 现有)

## 9. 风险

| 风险 | 缓解 |
|---|---|
| better-sqlite3 + Electron ABI 不匹配 | electron-rebuild,CI 验证(v0.5.0 已知 node ABI 139/127 切换问题) |
| worktree Windows 路径分隔符 | simple-git 处理,或 `path.join` + 正斜杠 |
| MCP 自驱只 Claude Code | 第一版明确局限,其他 provider 手动 Next;后续按 provider 适配 |
| 前端全新 UI 工作量 | W4 整周,复用 planrla 现有 UI 组件库(SettingsCard/SettingsRow 等)降本 |
| 5 provider 对称架构被破坏 | Runner 走统一 session 接口,不引入 provider 分支(经 `provider-capabilities` 验证) |

## 10. 后续 spec(本轮 out,留待)

1. **Relay 远程访问**:Cloudflare Tunnel PoC(1-2 天)验证需求 → 决定自建 relayer(Node/TS + WS + yamux 等价)+ E2EE
2. **会话双向同步**:回写 ~/.claude(先做改名/删会话安全操作,消息级编辑暂缓)
3. **会话 fork**
4. **团队协作**(channels/AI 队友,对标 Helio/Multica)
5. **agency 协同**(planrla 作 agency 执行层,替换 aion-gateway)
6. **商业化 Pro gating**(看板作为 Pro 功能?)

## 11. 验收标准

- 原生看板 tab 出现在主内容区(默认,不需装 task-master CLI)
- 可创建任务模板(多阶段,每阶段指定 agent/model/mode/prompt)
- 任务跑起来开 worktree 隔离,多任务并发不冲突
- 看板显示 aux 徽章(待答复/有计划/有TODO)
- Claude Code agent 能通过 MCP 工具自驱推进阶段
- 定时任务能触发 + webhook 通知能发出
- `npm run typecheck && npm test` 通过
