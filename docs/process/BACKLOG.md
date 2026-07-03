# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped

## In Progress
| ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|
| _(暂无)_ | | | | | | | | |

## Ready(四要素补齐,待规格化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| _(暂无)_ | | | | | |

## Backlog(待细化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 | 备注 |
|----|------|--------|-----|------|------|------|
| REQ-005 | Provider 诊断面板 | M3 | P1 | feat | backlog | |
| REQ-006 | License 试用/离线授权 | M6 | P1 | feat | backlog | |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | M6 | P1 | feat | backlog | |
| REQ-008 | Android 多主机扫描/管理恢复 | M4 | P0 | feat | backlog | 状态待核对(近期 Android 工作) |
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | — | P1 | feat | backlog | 见 PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md |
| REQ-011 | 桌面端自动更新(auto-update 全流程) | M6 | P1 | feat | backlog | electron-updater 下载/安装/重启 + 前端更新 UI + 更新源 + latest.yml + 代码签名 + 渠道;现状只检测不下载 |

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

> 注:v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 已含的其他完成项(桌面体验默认值 / 自绘标题栏 / 三态主题 UI / fr i18n / 项目性能优化 / 发版流程基建)未逐条回填 BACKLOG,见 CHANGELOG.md 与 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。后续如需精确追溯再补 REQ。
