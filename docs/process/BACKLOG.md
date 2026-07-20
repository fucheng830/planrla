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
| REQ-030 | AI 自动重命名(10 轮触发) | — | P2 | feat | doing | self | [spec](../superpowers/specs/2026-07-11-req030-ai-auto-rename-design.md) | [plan](../superpowers/plans/2026-07-11-req030-ai-auto-rename.md) | `feat/req030-auto-rename` 9 commits(Task 7 review),未入 main |
| REQ-040 | 状态校验工具 check-req-status(状态机↔git 自动绑定) | v0.9 | P1 | feat | review | self | [spec](../superpowers/specs/2026-07-16-req040-status-git-binding-design.md) | [plan](../superpowers/plans/2026-07-16-req040-status-git-binding.md) | `a476b7b` 在 main,待三道门验收 |
| REQ-027 | UX 对齐 Codex · 渲染层交互(① diff 高亮 + ② plan 展示 + ④ diff 评论) | — | P1 | feat | review | align:codex | [spec](../superpowers/specs/2026-07-08-req027-ux-align-codex-design.md) | [plan](../superpowers/plans/2026-07-08-req027-ux-align-codex.md) | 随 v0.8.0 发,待验收置 accepted |

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
