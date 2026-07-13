# Planrla 项目级 AI 工作台 · 产品需求文档(PRD)

> **版本**:v1.0(2026-07-11)
> **主题**:Planrla 从「多对话管理器」跃迁为「项目级 AI 工作台」
> **关联 REQ**:REQ-009(主线,doing)/ REQ-014(新需求入口,合并首切片)/ REQ-019(Kanban,待澄清)
> **本文档定位**:产品级框架文档(愿景 / 成功标准 / MVP 切分 / 构建顺序 / 风险),介于 [V1_PRODUCT_ROADMAP](./V1_PRODUCT_ROADMAP.md)(why/when)与 [PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS](./PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md)(what features)之间。详细 feature 规格不在此重复,引功能需求文档。

<context>

# Overview

## 背景与愿景

Planrla 已跑通 MVP:桌面端 / Web / Android / 后端 / 多 Provider / 商业授权 / Electron 分发(见 roadmap P0 完成记录)。近三个版本(v0.7.0 侧边栏合并、v0.8.0 跨会话上下文 MCP、v0.8.2 scroll-raf)持续在打磨「多对话管理器」体验。

但产品同名核心 —— **项目级 AI 工作台** —— 尚未真正落地。当前项目层是「多个对话的管理集合」:用户在对话里产出需求、方案、代码、验收结论,但这些沉淀散落在聊天记录中,无法作为项目一等对象被追踪、关联、归档。跨会话上下文(REQ-016,已发 v0.8.0)让 agent 能查历史会话,却仍没有「把对话组织成项目交付物」的能力。

**愿景**:让 Planrla 的项目层从「会话容器」升级为「可持续推进的软件交付空间」。对话仍是入口,但**项目对象(需求/方案/任务/验收/归档)和文档才是长期沉淀**。AI agent 的执行过程可计划、可追踪、可验收、可归档;多个 worker 可并行推进而不互相污染。

本周期聚焦把这条主流程打通:**需求提出 → 澄清 → 方案 → 任务拆分 → 执行 → 验收 → 归档**,以「需求」为锚点串起项目对象。

## 目标与非目标

**本周期目标(P1:项目对象 + 需求驱动流)**:
- 需求成为项目内一等对象:可创建、可从对话生成、可编辑(标题/背景/目标/范围/验收标准)、可状态流转、可关联会话/方案/任务
- 项目右键「新需求」入口落地(REQ-014),需求 tab/view 进项目页(已在 `req009-requirements` worktree 实现)
- 需求↔会话关联:任意会话可挂到一个需求下,反向查看需求下的所有会话
- 需求状态机可用:草稿→待确认→已确认→设计中→开发中→待验收→已完成/已废弃
- agent 可经内部 MCP 直接产出/关联需求(衔接 REQ-016)

**非目标(明确不做)**:
- 不在本周期做 worker 并行 + Git worktree 隔离(留 P2)
- 不在本周期做完整验收报告生成 + 文档归档自动化(留 P3)
- 不重写现有 session/project 数据模型,只在其上**叠加**项目对象层(向后兼容)
- 不做 Kanban 看板维度的完整设计(REQ-019 待澄清状态列/负责人/优先级维度后再排)
- 不把对话踢下主位 —— 对话仍是核心执行入口,项目对象是「沉淀层」不是「替代层」

## 成功指标

功能需求文档给了验收标准(功能可用性),本 PRD 补产品级 KPI —— 用于判断「项目工作台」是否真的成立的可观测信号(目标值为初版假设,需数据校准):

| 指标 | 定义 | 本周期目标 |
|---|---|---|
| **需求流转闭环率** | 进入「已确认」后走到「已完成」的需求占比 | ≥ 60% |
| **对话→需求转化率** | 从对话生成的需求 / 总需求 | ≥ 30% |
| **项目对象关联密度** | 平均每个需求关联的(会话 + 方案 + 任务)数 | ≥ 2 |
| **项目文档沉淀率** | 每个已完成需求平均沉淀文档数(方案/实现/验收) | ≥ 1.5(P3 后完整可测) |
| **首切片可用性** | 新用户在项目内创建需求并关联一次会话的操作步数 | ≤ 3 步 |

P1 结束时应能看到前两项(转化率、关联密度)的非零基线;后三项依赖 P2/P3 落地后完整可测。

# Core Features

详细 feature 清单见 [功能需求文档 §8-§10](./PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md)。本节只给产品级概貌。

**F1. 项目对象模型**(本周期核心):项目下新增 6 类一等对象 —— 需求、方案、任务、worker、验收记录、归档文档。每类对象有:唯一 ID、归属项目、状态、关联对象引用、活动时间线、来源会话。本周期落地「需求」对象,其余占位。

**F2. 需求驱动流**(本周期主流程):需求是锚点。从需求出发可挂会话、起方案、拆任务;反向从会话可「归到需求」。需求状态机驱动整个交付节奏。

**F3. 项目信息架构演进**:项目页从当前「Overview + Conversations」扩展为 `Overview / Conversations / Requirements / Plans / Tasks / Workers / Git / Docs / Activity`(见功能需求文档 §10)。本周期落地 Requirements tab(已在做),其余 tab 占位 + 渐进填充。

**F4. 与跨会话上下文(REQ-016,已发 v0.8.0)的衔接**:已落地的 `query_session` / `search_conversations` MCP 工具让 agent 能查历史会话;本周期让 agent 额外能「把这段对话归到需求 X」「新建需求」—— 项目对象成为 agent 可操作的一等实体。

# User Experience

**用户角色**(详见功能需求文档 §4):
- **普通开发者**:在项目里发起需求、挂会话、看任务状态、接验收
- **项目负责人**:管需求全生命周期、审批方案、看项目整体进展与风险、沉淀文档
- **高级用户**(P2+):多 worker 并行、查每个 worker 的 worktree/分支/diff、处理合并冲突

**核心场景**(本周期 P1):
1. **从对话提炼需求**:用户在会话里和 agent 聊清一个想法 → 右键/命令「转为需求」→ 需求对象创建(标题/背景从对话摘要生成,可编辑)→ 会话自动关联到该需求
2. **在项目页推进需求**:项目页 Requirements tab → 选需求 → 补目标/范围/验收标准 → 状态从「草稿」推到「已确认」
3. **需求下挂多会话**:同一需求下挂多轮对话(探索 / 实现 / 验证),反向在需求详情看全部关联会话
4. **需求状态流转**:草稿→待确认→已确认→设计中→开发中→待验收→已完成(或已废弃),每次流转记入活动时间线

**UX 原则**(继承 roadmap 迭代原则 §1):
- 默认流程短:从对话「转需求」≤ 3 步
- 状态清晰:每个需求状态有明确视觉(复用 `SessionTaskStatusBadge` 模式,REQ-025 已落地)
- 空状态引导:Requirements tab 空时提示「从某个会话提炼你的第一个需求」
- 各 tab 数据独立懒加载,不阻塞会话列表

</context>

<PRD>

# Technical Architecture

详细实现留 spec/plan,本节给架构约束与关键决策。

**数据模型**(叠加层,不动现有):
- 现有:`projects`、`sessions`(会话归属项目)
- 本周期新增:
  - `requirements`(id, project_id, title, background, goal, scope, acceptance_criteria_json, status, source_session_id, created_at, updated_at)
  - `requirement_session_links`(requirement_id, session_id)—— 多对多
  - `requirement_status_history`(requirement_id, from_status, to_status, changed_at, changed_by)—— 活动时间线基础
- 复用:状态机沿用 `src/shared/taskStatus.ts` 模式(集中定义、多端共享);搜索复用 `session-search.service` 的 FTS5 模式,扩展到 requirements 表

**API 契约**(REST,版本化,入 `docs/architecture/API_CONTRACT.md`):
- `POST /api/projects/:id/requirements`(创建,支持 `from_session_id`)
- `GET /api/projects/:id/requirements`(列表,支持 status 过滤)
- `PATCH /api/requirements/:id`(编辑字段 / 状态流转)
- `POST|DELETE /api/requirements/:id/sessions/:sid`(关联/取消关联会话)
- WebSocket:需求状态变更广播到项目页(复用现有 ws 节流机制)

**与现有模型的关系**(关键约束):
- 需求**不替代**会话,是会话的「上层组织」(一个需求 N 个会话)
- 现有 session 无需迁移;`requirement_session_links` 为空时项目 behaves 与今天一致(向后兼容)
- 项目页 Requirements tab 数据独立加载,不阻塞会话列表

**MCP / Agent 可操作性**(衔接 REQ-016):
- 内部 HTTP MCP(`/api/mcp/internal`,已落地)新增 `create_requirement` / `link_session_to_requirement` 工具,让 agent 在对话中直接产出项目对象
- 安全约束:agent 创的需求默认进「草稿」,只能创 + 关联,不能擅自改状态(见风险节)

**多端共享**:
- 状态机、字段、错误码定义在共享层(Android/Desktop/Web 一致),具体路径待 monorepo 演进(见 roadmap 工作区一体化策略)

# Development Roadmap

功能需求文档的 P0(Android 多主机 / Desktop 可发现性)已在 roadmap P0 完成记录中基本落地。本 PRD 周期 = **P1,P2/P3 为后续**。

**P1 · 本周期(项目对象 + 需求驱动流)—— MVP 切片**:
- 需求对象模型 + 表 + API(上节)
- 项目页 Requirements tab + view + i18n(✅ 已在 `req009-requirements` worktree)
- REQ-014:项目右键「新需求」入口 + 收集流程(✅ SidebarProjectContextMenu 已 refactor)
- 需求↔会话关联 UI(正反两向)
- 需求状态机 + 流转 UI + 活动时间线
- MCP `create_requirement` / `link_session_to_requirement`(agent 可操作)

**P2 · 下一周期(worker 并行 + Git 隔离)**:
- WorkerService:把项目当前用的 `.claude/worktrees/reqNNN-topic` 模式产品化 —— 每个 worker 一个独立 git worktree + 任务分支
- 方案(Plan)对象 + 审批流;任务(Task)对象 + 分配给 worker
- worker 状态 / diff / 测试结果展示;合并(直接 / 选择性应用 / patch / 放弃)+ 冲突检测
- 风险控制:合并前文件变更摘要、冲突提示、禁止覆盖主工作区未提交改动

**P3 · 再下一周期(验收 + 归档)**:
- 验收:每个需求验收标准 + 根据执行结果生成验收报告 + 通过 / 退回 / 暂缓
- 归档:需求 / 方案 / 实现 / 验收一键归档为项目文档;从对话归档结论;决策记录;活动时间线
- 文档类型:需求文档 / 技术方案 / 决策记录 / 实现记录 / 测试报告 / 验收报告 / 发布说明

# Logical Dependency Chain

构建顺序(先后严格,每步原子可交付、可独立验收):

1. **数据基础先行**:`requirements` 表 + `requirement_session_links` + 状态机定义(`taskStatus.ts` 模式)→ 后端 API + 类型共享。**无 UI 也能用 API 创需求**(基础)
2. **最小可见前端**:项目页 Requirements tab(列表 + 创建表单)→ 尽快有「看得见」的东西。✅ 已在 worktree 跑通
3. **关联双向**:会话→需求(从会话「转需求」)+ 需求→会话(需求详情看关联会话)→ 闭环「需求组织会话」价值
4. **状态流转 + 时间线**:状态机 UI + `requirement_status_history` → 需求有「进度」感
5. **入口可达**:REQ-014 项目右键「新需求」→ 不进项目页也能创需求(降低首步成本)
6. **Agent 可操作**:MCP 工具 → agent 在对话里产出需求(放大杠杆)
7. **(P2 起衔接)**:方案 / 任务对象 + WorkerService worktree 化 → 依赖 P1 需求对象已稳

**节奏原则**:每步原子、可独立验收、可被后续叠加。P1 的 1-6 步完成后,「需求驱动流」即成立,可发版;P2/P3 不阻塞 P1 发版。

# Risks and Mitigations

| 风险 | 影响 | 对策 |
|---|---|---|
| **范围蔓延** —— 功能需求文档 P0-P3 跨 4 大块、数十个 feature | 本周期做不完、迟迟不发版 | 死守 P1 MVP 切片(上节 6 项);P2/P3 明确为后续周期,不接受塞进 P1 |
| **REQ-019 Kanban 维度未澄清** —— 状态列 / 负责人 / 优先级哪个为主未定 | Tasks tab 设计卡住 | 本周期 Kanban 不做(非目标),先靠 Requirements tab 状态机承载;REQ-019 单独 brainstorm |
| **worker Git 冲突(P2)** —— 多 worktree 合并回主区冲突不可控 | 用户改坏主工作区 | P2 才做;合并前强制摘要 + 冲突提示 + 禁止覆盖未提交改动 + 失败保留 worktree(功能文档 §9.4) |
| **与现有 session 模型的断层** —— 老会话没挂需求,用户感觉割裂 | 体验断层 | `requirement_session_links` 为空时 behaves 如今(向后兼容);提供批量「补挂」入口(可选,P1 后期) |
| **长项目性能** —— 需求 / 文档 / 活动累积后项目页变慢 | 大项目卡顿 | 各 tab 数据独立懒加载;Activity timeline 分页;复用 ws 节流 |
| **agent 创建需求的可靠性** —— MCP 让 agent 创需求,可能误创 / 垃圾需求 | 需求池被污染 | agent 创的需求默认进「草稿」,需用户确认才流转;agent 只能创 + 关联,不能改状态 |
| **指标不可测** —— KPI 依赖 P3 归档才完整可测 | 本周期末看不出成效 | P1 结束先看「对话→需求转化率」「关联密度」两项非零基线;完整 KPI 待 P3 |

# Appendix

**关联文档**:
- [V1_PRODUCT_ROADMAP.md](./V1_PRODUCT_ROADMAP.md) —— v1 战略里程碑(M1-M6),本 PRD 对其「项目层升级」主线的展开
- [PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md](./PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md) —— 详细功能需求(P0-P3 全 feature、用户角色、验收标准)。本 PRD 不重复,只引
- [UX_INFORMATION_ARCHITECTURE.md](./UX_INFORMATION_ARCHITECTURE.md) —— UX 与信息架构
- [API_CONTRACT.md](../architecture/API_CONTRACT.md) —— REST/WebSocket 协议(本周期新增需求 API 入此)
- [PROVIDER_CONTRACT.md](../architecture/PROVIDER_CONTRACT.md) —— Provider 能力声明

**关联 REQ**(见 [BACKLOG.md](../process/BACKLOG.md)):
- REQ-009 项目级工作台(本 PRD 主线,status 实际为 doing,worktree `req009-requirements`)
- REQ-014 项目右键「新需求」入口(合并入 REQ-009 首切片,已 refactor)
- REQ-019 Kanban 看板(待澄清维度,非本周期)
- REQ-016 跨会话上下文 MCP(已发 v0.8.0,本周期 `create_requirement` 工具衔接到项目对象层)

**术语**:
- **项目对象**:需求 / 方案 / 任务 / worker / 验收记录 / 归档文档 的统称,项目内一等实体
- **需求驱动流**:以需求为锚点串联 会话→方案→任务→验收→归档 的主交付流程

**后续动作**:
- 本 PRD 评审通过 → 拆 P1 为 spec(`docs/superpowers/specs/`)→ plan → 实施(在 `req009-requirements` worktree 继续)
- P1 完成发版后,本 PRD 的 P2/P3 段落各自升级为独立 spec
