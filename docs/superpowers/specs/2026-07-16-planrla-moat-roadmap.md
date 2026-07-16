# planrla 护城河版本迭代 Roadmap

> 日期:2026-07-16
> 状态:Draft(每个版本启动时再用 writing-plans 细化为可执行 plan)
> 当前基线:v0.8.4(已 push origin/main)
> 关联记忆:project_planrla_state、project_planrla_kanban_w1
> 结论来源:2026-07-16 护城河战略讨论

## 1. 背景与战略命题

UI/交互已被 AI 商品化,不再是护城河。planrla 当前形态("CLI Agent 的跨端 UI")处在**护城河最浅**的位置:
- **上游受控**:Claude/Codex/Cursor/Gemini 的 agent 能力全在上游手里,上游把 GUI 做齐就挤压中间层。
- **pass-through**:有价值的工作记忆沉淀在 `~/.claude` 等底层 CLI 目录,不在 planrla;会话还是单向同步。用户从 planrla 换到 MindFS/官方 app,**零迁移成本**。
- **同质化红海**:MindFS 等。
- multi-provider 对称架构目前是**工程亮点而非护城河**(上游一变就碎、用户大多只用 1-2 个 provider、竞品会跟进)。

**战略命题**:planrla 必须从"CLI 的 UI 壳(pass-through)"升级为"用户 agent 工作流的 **accumulation point(积累点)**"。护城河只能长在**随时间积累、迁移成本高、且沉淀在 planrla 这一层(而非底层 CLI)**的东西上。

**四个押注**:
- ① 跨 provider 统一工作记忆层(主线,地基)
- ② 看板自驱 runner → 跨 provider 可视化 agent 编排引擎(技术壁垒)
- ③ 团队/多设备协作 → 网络效应(第二曲线)
- ④ Relay + E2EE + 会话双向回写(防守;"双向回写"即 ① 的技术核心,不重复)

## 2. 假设

1. **定位**:保持 agnostic / multi-provider(① 的地基要求),不走垂直化;把"通用 CLI UI"往"跨 provider agent 编排+记忆平台"漂移。
2. **节奏**:solo + agent 高产节奏,周期为粗估,可伸缩。
3. **主线**:① 是地基,②③ 挂在 ① 上;④ 的"双向回写"=① 核心。

## 3. Roadmap 总览

| 版本 | 主题 | 押注 | 周期(估) | 依赖 | 战略角色 |
|---|---|---|---|---|---|
| v0.9 | 看板收口 + 最小防守 | 兑现沉没成本 / ④ | 1–2w | — | 兑现已花投入为可交付 |
| **v1.0** | 跨 provider 统一工作记忆(双向回写) | **① 主线** | 4–6w | v0.9 | **护城河地基** |
| v1.1 | 记忆飞轮 + 可发现性 | ① 产品化 | 2–3w | v1.0 | 切换成本肉眼可见 |
| v1.2 | 看板 → 编排引擎 | **②** | 3–5w | v1.0 | 技术壁垒 |
| v1.3 | Relay + E2EE | ④ | 2–4w | — | 防守 / 隐私叙事 |
| v2.0 | 团队 / 多设备协作 | **③ 第二曲线** | 4–6w | v1.0+v1.2+v1.3 | 网络效应 |

## 4. 各版本展开

### v0.9 — 看板收口 + 最小防守(1–2w)
**目标**:把看板(W1–W4)的沉没成本兑现成可发版交付,堵最小漏洞。
- ✅ ~~push origin~~(已完成,main 与 origin/main 同步至 v0.8.4)
- 🔴 **live agent 端到端验证 + 修复**:定位"13 上 Claude provider 起不来"(`queryClaudeSDK` spawn 无 claude 进程,任务卡 running)。**已有 `feat/provider-diag` worktree 在诊断,先合并/确认其结论再决定是否补修。**
- C1 修复(bare response → envelope)live 验证
- 补 `/api/mcp/kanban` 安全(auth 前挂载 + HOST=0.0.0.0 → loopback/shared-secret)
- 多模板 board 分组显示(follow-up)
- 🆕 **REQ-040 状态机↔git 自动绑定**(治理地基,2026-07-16 卡点诊断补入,原 roadmap 盲点):BACKLOG 状态从 git 自动推导/校验,消除手动对账人工(`PLANS_STATUS` 式梳理降为一键查询)。是看板自驱可信度的前提。见 `BACKLOG.md` REQ-040 四要素。
**退出标准**:真实 Claude agent 从 worktree `.mcp.json` 发现 MCP、自驱推进,端到端跑通;可发版。

### v1.0 — 跨 provider 统一工作记忆(① 主线,4–6w)⭐
**目标**:从 pass-through 变 accumulation point。整个护城河战略的奠基石。
交付:
1. **统一记忆数据模型**(provider-agnostic:决策/上下文/skills/prompt 模板)
2. **双向同步**:sessions 从磁盘→DB 升级为双向,planrla 向各 provider 目录**回写**统一记忆/配置(把积累点从 CLI 抢到 planrla 的本质动作)
3. **跨 provider 记忆投射**(Claude 跑出的上下文,Codex 复用)
4. 统一 skills/prompt/agent 配置库(一处维护,多 provider 投射)
**退出标准**:同项目用 Claude 跑的 agent 记忆/配置,Codex 能复用;切 provider 不丢上下文。
**关键风险**:
- 🔴 **回写数据安全**:向 `~/.claude` 回写若损坏既有 CLAUDE.md/记忆 = 灾难。必须 dry-run + 版本化 + 一键回滚 + 写前 diff 审阅。**v1.0 成败单点。**
- 🟡 provider 目录格式异构(CLAUDE.md / AGENTS.md / cursor rules),归一化工程量 = 壁垒。
- 🟡 双向冲突合并策略。

### v1.1 — 记忆飞轮 + 可发现性(2–3w)
**目标**:让用户感知 planrla 替他积累了什么、且搬不走。
- 记忆可视化/检索/管理 UI;跨项目复用 + 版本/回滚。
**退出标准**:用户能指着 UI 说"这是我用 planrla 的理由,换工具这些全没了"。

### v1.2 — 看板 → 编排引擎(②,3–5w)
**目标**:W1–W4 runner 从"单机看板"升级为"跨 provider 可视化 agent 流水线引擎"。
- 看板接入 v1.0 统一记忆(编排 × 记忆打通)
- 多 provider 混合编排(一流水线多阶段用不同 provider;上游单家做不出)
- 模板生态(内置 + 用户共享)+ worktree 多任务并发
**退出标准**:用户能定义并可视化跑通跨 provider 多阶段流水线,模板可复用/共享。

### v1.3 — Relay + E2EE(2–4w,防守,可穿插)
**目标**:补"from everywhere + 数据在本地"破洞。
- Relay(免端口远程)+ E2EE(远程会话端到端加密)。
**退出标准**:不开 VPS 也能 everywhere,链路加密。

### v2.0 — 团队 / 多设备协作(③ 第二曲线,4–6w)
**目标**:单人工具 → 团队协作层,引入网络效应。
- 团队共享看板 + 团队级共享记忆/配置/skills + 产出物协作可见性/review + 基于 Relay 的多设备实时同步。
**退出标准**:团队共享一条流水线,各自 agent 推进、人 review,数据沉淀走不掉。

## 5. 优先级与取舍

- **不可砍**:v1.0(①②③ 地基 + 自带防守)。
- **砍序**(最该砍起):v1.1 → v1.3 → v2.0 → v1.2,保 v1.0。
- 最快见"护城河感":v1.0 + v1.1。
- 技术壁垒叙事:v1.0 + v1.2。
- v0.9、v1.3 独立模块,随时穿插。

**主线**:v0.9 兑现 → v1.0 抢积累点 → v1.1 积累可见 → v1.2 编排起来 → v1.3 补通道 → v2.0 网络增值。

## 6. 退化方案(资源砍半)
保 v1.0 核心(统一记忆 + 双向回写),v1.1 简化为"最小记忆管理 UI",v1.2 推后,v1.3/v2.0 暂缓。即使如此,planrla 已从"UI 壳"变为"agent 工作记忆的归属层",护城河地基成立。

## 7. 护城河度量(怎么判断护城河在形成)
功能做完 ≠ 护城河形成。用以下指标验证:
- **积累深度**:用户在 planrla 沉淀的记忆/配置/模板条数,及跨 provider 复用次数。
- **切换成本(可测)**:重度用户迁移到 MindFS/官方 app 后,丢失多少 planrla 独有积累(丢失条目数/复用关系数)。
- **留存/依赖**:DAU 中"使用了 planrla 独有能力(统一记忆/编排)而非纯 CLI 壳"的占比。
- **网络密度**(v2.0 后):团队数、共享看板数、跨成员复用次数。
- **反向验证**:每个版本发布后问"删掉这个版本,用户迁移成本是否上升?"——上升才算护城河增量。
