# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped

## In Progress
| ID | 标题 | 里程碑 | P | 类型 | 状态 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|
| REQ-012 | 桌面 native ABI 修复(sync-native-abi + npmRebuild=false) | — | P0 | fix | review | _(dfaf4be,未走 spec 流程)_ | — | 待 v0.4.1 |

## Ready(四要素补齐,待规格化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| _(暂无)_ | | | | | |

## Backlog(待细化)
| ID | 标题 | 里程碑 | P | 类型 | 状态 | 备注 |
|----|------|--------|-----|------|------|------|
| REQ-003 | 会话列表分页/缓存 | M2 | P1 | perf | backlog | |
| REQ-004 | WebSocket 消息节流/合并 | M2 | P1 | perf | backlog | |
| REQ-005 | Provider 诊断面板 | M3 | P1 | feat | backlog | |
| REQ-006 | License 试用/离线授权 | M6 | P1 | feat | backlog | |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | M6 | P1 | feat | backlog | |
| REQ-008 | Android 多主机扫描/管理恢复 | M4 | P0 | feat | backlog | 状态待核对(近期 Android 工作) |
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | — | P1 | feat | backlog | 见 PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md |
| REQ-011 | 桌面端自动更新(auto-update 全流程) | M6 | P1 | feat | backlog | electron-updater 下载/安装/重启 + 前端更新 UI + 更新源 + latest.yml + 代码签名 + 渠道;现状只检测不下载 |

## Released(已发版)
| ID | 标题 | 版本 | spec |
|----|------|------|------|
| REQ-000 | 桌面端三态主题(system/light/dark) | v0.2.0 | _(未走本流程)_ |
| REQ-001 | 官网落地页(Cloudflare Pages + release feed) | v0.3.0 | [spec](../superpowers/specs/2026-07-02-landing-page-design.md)(landing MVP;CF 部署待) |
| REQ-010 | 桌面打包模式禁用 restartRequired 误报 | v0.3.0 | [spec](../superpowers/specs/2026-07-02-req010-restart-required-fix-design.md) |
| REQ-002 | 文件树增量加载 + react-window 虚拟化 | v0.4.0 | _(feat/file-tree-v2 破例直发,见 releases/v0.4.0.md)_ |

> 注:v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 已含的其他完成项(桌面体验默认值 / 自绘标题栏 / 三态主题 UI / fr i18n / 项目性能优化 / 发版流程基建)未逐条回填 BACKLOG,见 CHANGELOG.md 与 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。后续如需精确追溯再补 REQ。
