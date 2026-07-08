# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped / **parked**(暂搁,不进近期队列)

> **2026-07-07 backlog 清理**:合并母/子主题(REQ-009 族 / REQ-015→016 / REQ-022→021)、核对 REQ-008(已实现,移 Released)、模糊/商业项移 Parked。active backlog 13 → **4 个可动 entry point**。

## In Progress
| ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|
| REQ-023 | 桌面端外链系统浏览器打开 | — | P1 | fix | accepted | [spec](../superpowers/specs/2026-07-06-external-link-handling-design.md) | [plan](../superpowers/plans/2026-07-06-req023-external-link-handling.md) | v0.6.2 |
| REQ-024 | 合并「对话」与 Running sessions 侧边栏视图 | — | P1 | feat | released | [spec](../superpowers/specs/2026-07-06-merge-chat-running-sessions-design.md) | [plan](../superpowers/plans/2026-07-07-req024-merge-chat-running-sessions.md) | v0.7.0 |
| REQ-025 | 侧边栏状态 UI 统一(Projects / Sessions / 搜索) | — | P1 | fix | released | [spec](../superpowers/specs/2026-07-07-req025-sidebar-status-ui-unify-design.md) | [plan](../superpowers/plans/2026-07-07-req025-sidebar-status-ui-unify.md) | v0.7.0 |
| REQ-026 | Sessions 切换按钮去双徽标(只留 completed 计数) | — | P1 | fix | released | _(ad-hoc)_ | | v0.7.1 |

## Ready(四要素补齐,待规格化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| _(暂无)_ | | | | | |

## Backlog(待细化)— 按主题分组

### 🎯 下一个(已 prep,可开工)
| ID | 标题 | P | 类型 | 状态 | 备注 |
|----|------|----|------|------|------|
| REQ-016 | 跨会话 @引用 + 整段历史(L1 × C1+C2) | P1 | feat | backlog | **REQ-015 跨对话上下文共享的首切片**(L2/L3 跨设备、C3 摘要、C4 持久记忆 = 后续阶段,暂 parked 在 REQ-015 母条目);已有 [design-draft](./design-drafts/req016-context-share-draft.md);Provider 无关(纯文本注入,Claude↔Codex 同样工作);复用 session messages API + `useFileMentions`。**下一步:进 brainstorming 出 spec** |

### 🏗 战略主题(下个大周期)
| ID | 标题 | P | 类型 | 状态 | 备注 |
|----|------|----|------|------|------|
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | P1 | feat | backlog | **产品同名核心,最大战略价值**。含子(合并做):**REQ-014**(项目右键「新需求」入口 + 收集流程,合并首切片)、**REQ-019**(Kanban 看板,待澄清维度:状态列/负责人/优先级)。首切片 = 需求对象模型 + REQ-014 入口。见 `PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md` |

### 🔧 独立 / 基础设施(可并行)
| ID | 标题 | P | 里程碑 | 类型 | 状态 | 备注 |
|----|------|----|--------|------|------|------|
| REQ-021 | UX 对齐 Codex(动效 + 网页/图片预览 + 交互优化) | P1 | — | feat | backlog | 独立 UX 专项,可先行;是 REQ-022(UX 子集),母项 parked |
| REQ-027 | UX 对齐 Codex · 渲染层交互优化(① diff 高亮 + ② plan 展示 + ④ diff 评论) | P1 | — | feat | plan | REQ-021 首切片;[spec](../superpowers/specs/2026-07-08-req027-ux-align-codex-design.md) · [plan](../superpowers/plans/2026-07-08-req027-ux-align-codex.md) |
| REQ-005 | Provider 诊断面板 | P1 | M3 | feat | backlog | |

## Parked(暂搁,不进近期队列)
| ID | 标题 | 搁置原因 |
|----|------|----------|
| REQ-006 | License 试用/离线授权 | 商业化,等核心锁型(M6 阶段) |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | 商业化,等核心锁型(M6 阶段) |
| REQ-015 | 跨对话上下文共享(母,L2/L3/C3/C4 后续阶段) | 首切片拆为 REQ-016 先行;母条目剩余阶段待 REQ-016 落地后再排 |
| REQ-020 | A2A(Agent-to-Agent 通信/协作) | **范围未定**(Google A2A 标准协议 vs planrla 内部多 Agent 委派),澄清前不 brainstorm |
| REQ-022 | 对齐 Codex 全特性集(母) | **需先做 Codex 特性审计 → Archie 标优先级**,再拆子 REQ;UX 子集已拆 REQ-021 可先行 |

## Blocked(冻结/待想清楚)
| ID | 标题 | P | 类型 | 状态 | 冻结原因 | 设计结论(brainstorm) |
|----|------|---|------|------|----------|----------------------|
| REQ-013 | 会话自动重命名(LLM 生成标题) | P2 | feat | blocked | LLM 接入未定:server 端调 Haiku 需 ANTHROPIC_API_KEY,但 Claude Code 走 OAuth 时 server 拿不到 API key。待想清楚接入方式(API key / 复用 Claude Code 凭据 / 本地 Ollama / claude-agent-sdk) + 触发时机/成本后再做 | **痛点**:现有标题=第一条消息全文(4462 中 4400 是消息片段,长/重复/无区分;codex 62 Untitled)。**方案**:Claude Haiku 读会话内容(extractSessionText 取前 N 条)生成 5-15 字主题 + 全量4462 重生成 + 增量(synchronizer hook 同搜索 Task 7 点) + 去重后缀(同 project 冲突加 #2)。**3 个 LLM 请求点**:批量(retile-all)/增量(新 session)/手动单个(:id/retile)。**成本估**:批量 ~$1.2(Haiku),增量/手动极低 |

## Released(已发版)
| ID | 标题 | 版本 | spec |
|----|------|------|------|
| REQ-000 | 桌面端三态主题(system/light/dark) | v0.2.0 | _(未走本流程)_ |
| REQ-001 | 官网落地页(Cloudflare Pages + release feed) | v0.3.0 | [spec](../superpowers/specs/2026-07-02-landing-page-design.md)(landing MVP;CF 部署待) |
| REQ-010 | 桌面打包模式禁用 restartRequired 误报 | v0.3.0 | [spec](../superpowers/specs/2026-07-02-req010-restart-required-fix-design.md) |
| REQ-002 | 文件树增量加载 + react-window 虚拟化 | v0.4.0 | _(feat/file-tree-v2 破例直发,见 releases/v0.4.0.md)_ |
| REQ-012 | 桌面 native ABI 修复(sync-native-abi + npmRebuild=false) | v0.4.1 | _(dfaf4be,未走 spec 流程;见 releases/v0.4.1.md)_ |
| REQ-004 | WebSocket 消息节流/合并 | main(M2) | _(M2 sub-project C ws-batch 覆盖:shouldPersist rAF 批量 + 去 latestMessage;merge 2e64af3)_ |
| REQ-003 | 会话列表分页/缓存 | main(M2) | _(M2 sub-project D projects-perf 覆盖:batched SQL + grouping,N+1 消除)_ |
| REQ-017 | Linux headless server Docker 镜像(server-only) | v0.5.0 | _(36bf31f,ad-hoc 未走 spec;见 releases/v0.5.0.md)_ |
| REQ-018 | 桌面端 i18n 完整改造 + Android UI 修复 + 云设备管理 | v0.5.0 | _(7716098,ad-hoc 未走 spec;80 文件 +1944/-699;见 releases/v0.5.0.md)_ |
| REQ-008 | Android 多主机扫描/管理 | ~v0.5.0 | _(状态已核对 2026-07-07:`apps/android/.../data/HostScanner.kt` 84 行真实现 + ConnectScreen/SettingsScreen/ChatScreen 引用,功能在。版本未精确归属,v0.5.0「Android UI 修复 + 云设备管理」工作覆盖)_ |
| REQ-011 | 桌面端自动更新(Tasks 1-9,含 e2e) | v0.6.0/v0.6.1 | _(merge `57a3919` + `3393d55`/`65dbfaa` publish-r2 fix;**e2e 通过**:v0.6.0→v0.6.1 升级链路实测成功;R2 更新源 live;见 releases/v0.6.0.md + v0.6.1.md)_ |

> 注:v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 已含的其他完成项(桌面体验默认值 / 自绘标题栏 / 三态主题 UI / fr i18n / 项目性能优化 / 发版流程基建)未逐条回填 BACKLOG,见 CHANGELOG.md 与 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。后续如需精确追溯再补 REQ。
