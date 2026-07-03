# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped

## In Progress
| ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|
| REQ-001 | 官网落地页(Cloudflare Pages + release feed) | — | P1 | feat | plan | [spec](../superpowers/specs/2026-07-02-landing-page-design.md) | [plan](../superpowers/plans/2026-07-02-landing-page-impl.md) | — |
| REQ-010 | 桌面打包模式禁用 restartRequired 误报 | M1 | P1 | fix | review | [spec](../superpowers/specs/2026-07-02-req010-restart-required-fix-design.md) | [plan](../superpowers/plans/2026-07-02-req010-restart-required-fix-impl.md) | — |

## Ready(四要素补齐,待规格化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| _(暂无)_ | | | | | |

## Backlog(待细化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 | 备注 |
|----|------|--------|-----|------|------|------|
| REQ-002 | 文件树增量加载 | M2 | P1 | perf | released | v0.4.0(2026-07-03)破例直发,详见 [releases/v0.4.0.md](releases/v0.4.0.md) |
| REQ-003 | 会话列表分页/缓存 | M2 | P1 | perf | backlog | |
| REQ-004 | WebSocket 消息节流/合并 | M2 | P1 | perf | backlog | |
| REQ-005 | Provider 诊断面板 | M3 | P1 | feat | backlog | |
| REQ-006 | License 试用/离线授权 | M6 | P1 | feat | backlog | |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | M6 | P1 | feat | backlog | |
| REQ-008 | Android 多主机扫描/管理恢复 | M4 | P0 | feat | backlog | 状态待核对(近期 Android 工作) |
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | — | P1 | feat | backlog | 见 PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md |
| REQ-011 | 桌面端自动更新(auto-update 全流程) | M6 | P1 | feat | backlog | electron-updater 下载/安装/重启 + 前端更新 UI + 更新源 + latest.yml + 代码签名 + 渠道(stable/beta/internal);现状只检测不下载(autoDownload=false) |

## Released(已发版)
| ID | 标题 | 版本 | spec |
|----|------|------|------|
| REQ-000 | 桌面端三态主题(system/light/dark) | v0.2.0 | _(未走本流程)_ |

> 注:v0.1.0 / v0.2.0 已含的其他 P0 完成项(API/任务状态协议草案、Provider Contract 草案、UX 信息架构、taskStatus 模型、长会话窗口化)未逐条回填,见 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。后续如需精确追溯再补 REQ。
