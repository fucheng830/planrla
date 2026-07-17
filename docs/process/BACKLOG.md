# Planrla 需求池(SSOT)

> 流程与状态机见 [README.md](./README.md)。战略层见 `docs/product/V1_PRODUCT_ROADMAP.md`。
> 字段:ID | 标题 | 里程碑 | P | 类型 | 状态 | 来源 | spec | plan | 版本
> `来源` 取值见 [FEEDBACK_TRIAGE.md](./FEEDBACK_TRIAGE.md):self / user:discord / user:issue#N / user:hosted / data / align:<竞品> / churn。**新 REQ 必填,历史 released 不溯。**
> 状态:backlog / ready / spec / plan / doing / review / accepted / released / blocked / dropped / **parked**(暂搁,不进近期队列)

> **2026-07-07 backlog 清理**:合并母/子主题(REQ-009 族 / REQ-015→016 / REQ-022→021)、核对 REQ-008(已实现,移 Released)、模糊/商业项移 Parked。active backlog 13 → **4 个可动 entry point**。

## In Progress
| ID | 标题 | 里程碑 | P | 类型 | 状态 | 来源 | spec | plan | 版本 |
|----|------|--------|-----|------|------|------|------|------|------|
| REQ-023 | 桌面端外链系统浏览器打开 | — | P1 | fix | accepted | self | [spec](../superpowers/specs/2026-07-06-external-link-handling-design.md) | [plan](../superpowers/plans/2026-07-06-req023-external-link-handling.md) | v0.6.2 |
| REQ-024 | 合并「对话」与 Running sessions 侧边栏视图 | — | P1 | feat | released | self | [spec](../superpowers/specs/2026-07-06-merge-chat-running-sessions-design.md) | [plan](../superpowers/plans/2026-07-07-req024-merge-chat-running-sessions.md) | v0.7.0 |
| REQ-025 | 侧边栏状态 UI 统一(Projects / Sessions / 搜索) | — | P1 | fix | released | self | [spec](../superpowers/specs/2026-07-07-req025-sidebar-status-ui-unify-design.md) | [plan](../superpowers/plans/2026-07-07-req025-sidebar-status-ui-unify.md) | v0.7.0 |
| REQ-026 | Sessions 切换按钮去双徽标(只留 completed 计数) | — | P1 | fix | released | self | _(ad-hoc)_ | | v0.7.1 |
| REQ-013 | 会话重命名(chat 触发 MCP 工具) | — | P2 | feat | released | self | [spec](../superpowers/specs/2026-07-09-req013-session-rename-chat-mcp-design.md) | [plan](../superpowers/plans/2026-07-09-req013-session-rename-chat-mcp.md) | v0.8.0 |
| REQ-020 | A2A 双向节点(client→server→内部协作,Google 标准) | — | P2 | feat | spec | self | S1 [spec](../superpowers/specs/2026-07-11-req020-a2a-s1-client-tools-design.md) | _(3 切片:S1 client 工具 → S2 server 端点 → S3 内部协作;S1 待 writing-plans)_ | |
| REQ-040 | 状态校验工具 check-req-status(状态机↔git 自动绑定) | v0.9 | P1 | feat | review | self | [spec](../superpowers/specs/2026-07-16-req040-status-git-binding-design.md) | [plan](../superpowers/plans/2026-07-16-req040-status-git-binding.md) | |

## Ready(四要素补齐,待规格化)
> ⚠️ **编号冲突(待 Archie 清理)**:下面「REQ-030 loadEarlier 翻页」实为 **REQ-029**(scroll RAF,已 merge 进 main,见 plan `2026-07-10-req029-scroll-raf.md`,待发版回填 Released);「REQ-030」已正式分配给 **AI 自动重命名**(见下方 Backlog 独立区 + spec/plan `2026-07-11-req030-ai-auto-rename`)。建议把这条 stale 条目改号为 REQ-029 并移 Released。

| ID | 标题 | 里程碑 | P | 类型 | 状态 |
|----|------|--------|-----|------|------|
| REQ-030 | loadEarlier 翻页 scroll 位置保持(RAF 补偿) | — | P1 | fix | ready |
| REQ-031 | 对话下方大片空白(virtualizer 高度虚高) | — | P1 | fix | ready |

### REQ-030 四要素
- **背景**:message-virtualization 已落地(`measureElement` 动态行高,解决 104px 锚点漂移)。但翻页(滚顶自动 `loadOlderMessages`)后的 scroll 位置保持是 **one-shot `useLayoutEffect`**(`useChatSessionState.ts` L373-380),与初始滚到底的 **RAF loop**(L393-434)不一致。`measureElement` 异步测高 → 补偿执行时 `newScrollHeight` 尚未反映完新增高度 → `heightDiff` 偏小 → 残余下跳;长消息(tool diff / 长 markdown)偏差最大。手动 `loadEarlierMessages`(L797,legacy 视图)完全无补偿。
- **目标**:翻页后 scroll 视觉位置稳定,健壮度对齐初始滚到底(反复校正直到 `scrollHeight` 稳定)。
- **范围**:改 L373-380 one-shot → RAF loop(复用 L393-434 已验证模式);评估手动 `loadEarlierMessages`(legacy 视图)是否同修。**不动** `ChatMessagesPane` 的 virtualizer 本身、**不动**分页数据模型(`visibleMessages = slice(-visibleMessageCount)`)。
- **验收草稿**:① 长消息会话(含长 tool diff/markdown)连翻 3+ 页,加载完成瞬间无可见下跳;② 短消息会话翻页不回归;③ 初始滚到底行为不变;④ `npm run typecheck && npm run build:client` 干净。
- **来源**:self(代码静态分析:measureElement 异步测高 vs one-shot 补偿的固有冲突)。**建议**:实施前可先实测确认肉眼可见度,作为 brainstorm 输入。

### REQ-031 四要素
- **背景**:Archie 截图实测(Web 端 `192.168.0.13:5173`)— 对话最后一条消息与底部输入框之间出现约 **40-50% 屏高的大片留白**,右侧滚动条未到底(滚动区比真实内容高)。`ChatMessagesPane.tsx` 用 `@tanstack/react-virtual`:`estimateSize:()=>104`(L154)初估每条 104px,内层 `<div style={{height: virtualizer.getTotalSize()}}>`(L267)撑开整个滚动区,`measureElement`(L275)异步测真实高度。**疑似根因**(待实测确认):① `estimateSize`(104)对短消息虚高,measure 未跟上时 `getTotalSize()` > 真实内容总和 → 底部留白;② 已测消息高度事后变化(tool 展开/折叠、代码块/Markdown 懒渲染、图片加载、streaming 增长)未触发 re-measure → 缓存尺寸漂移、累计虚高;③ 需排查是否为刚 merge 的 REQ-029 scroll RAF 回归。
- **目标**:对话滚动区高度 = 真实内容高度,消除底部虚高留白;短/长消息、展开折叠工具、streaming 过程中均稳定无残影。
- **范围**:主改 `ChatMessagesPane.tsx`(virtualizer 配置:`estimateSize` 策略 / `measureElement` 重测触发)+ 视根因可能触及 `useChatSessionState.ts` scroll 逻辑。**不动**分页数据模型(`visibleMessages = slice(-visibleMessageCount)`)、**不动** virtualizer 选型(message-virtualization 已落地)。**实施前先实测确认根因**(精确复现路径 + measure 时序),作为 brainstorm 输入。
- **验收草稿**:① 短消息会话(1-3 条)无底部留白;② 长消息 / 含长 tool diff 的会话滚到底无虚高;③ 工具结果展开/折叠后高度即时收敛、无残留空白;④ REQ-029 的 loadEarlier 翻页 scroll 位置保持不回归;⑤ `npm run typecheck && npm run build:client` 干净。
- **来源**:self(Archie 截图实测 + 代码静态分析:virtualizer getTotalSize 虚高)。**建议**:spec 前先实测确认根因(① vs ② vs ③),避免误改 virtualizer。

## Backlog(待细化)— 按主题分组

### 🎯 下一个(已 prep,可开工)
| ID | 标题 | P | 类型 | 状态 | 备注 |
|----|------|----|------|------|------|
| REQ-016 | 跨会话上下文:MCP 定点查询 + 全局搜索(L2+L3,已发版) | P1 | feat | released | **v0.8.0 已发**。演进:v1 preload(否,慢/卡)→ L2 HTTP MCP(`query_session` 工具,agent 按需查单 session;spec [L2](../superpowers/specs/2026-07-08-req016-mcp-query-design.md))→ L3 A+B+C(`search_conversations` 全局 FTS5 工具 + `/search` 命令 + 结果卡片)。复用 sidebar 的 `session-search.service`。@reference UI(picker/chip)保留共存。REQ-015 母(L3 跨设备/C3 摘要/C4 记忆)仍 parked |

### 🏗 战略主题(下个大周期)
| ID | 标题 | P | 类型 | 状态 | 来源 | 备注 |
|----|------|----|------|------|------|------|
| REQ-009 | 项目级工作台(需求/方案/任务/验收/归档) | P1 | feat | backlog | self | **产品同名核心,最大战略价值**。含子(合并做):**REQ-014**(项目右键「新需求」入口 + 收集流程,合并首切片)、**REQ-019**(Kanban 看板,待澄清维度:状态列/负责人/优先级)。首切片 = 需求对象模型 + REQ-014 入口。见 `PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md` |

### 🔧 独立 / 基础设施(可并行)
| ID | 标题 | P | 里程碑 | 类型 | 状态 | 来源 | 备注 |
|----|------|----|--------|------|------|------|------|
| REQ-021 | UX 对齐 Codex(动效 + 网页/图片预览 + 交互优化) | P1 | — | feat | backlog | align:codex | 独立 UX 专项,可先行;是 REQ-022(UX 子集),母项 parked |
| REQ-027 | UX 对齐 Codex · 渲染层交互优化(① diff 高亮 + ② plan 展示 + ④ diff 评论) | P1 | — | feat | review | align:codex | REQ-021 首切片;[spec](../superpowers/specs/2026-07-08-req027-ux-align-codex-design.md) · [plan](../superpowers/plans/2026-07-08-req027-ux-align-codex.md) |
| REQ-005 | Provider 诊断面板 | P1 | M3 | feat | backlog | self | |
| REQ-028 | Grok Build CLI provider(SuperGrok 订阅 OAuth) | P2 | — | feat | backlog | self | [spike](../design-drafts/req028-supergrok-xai-oauth-spike.md):**方向修正(v2)**——Grok 有官方 coding agent CLI(Grok Build,对标 Claude Code),走 **CLI agent provider**(第6个,仿 opencode spawn 模式,非 http 异类);streaming-json + session resume + ACP 满足接入;官方 OAuth 干净;⚠️ tier 403 + streaming-json schema 待实测。来源 align:alma(yetone 帖子) |
| REQ-030 | AI 自动重命名(10 轮触发) | P2 | — | feat | spec | self | [spec](../superpowers/specs/2026-07-11-req029-ai-auto-rename-design.md):REQ-013 §9 排除项补回;前端 silent 调用无标题 rename hint → agent 生成标题调 set_session_title;**固定 10 轮触发**/只一次/不覆盖已有标题;复用 REQ-013 全套(set_session_title + formatRenameCommandHint + WS session_renamed);跨 provider;不改 server/systemPrompt/DB |
| REQ-032 | 消除「点进会话快速冲到底」初始滚动冲底(F1 首帧锚定 + F3 estimateSize 滚动平均) | P1 | — | fix | spec | self | [spec](../superpowers/specs/2026-07-11-req032-chat-initial-scroll-rush-design.md):初始滚底 `useEffect`→`useLayoutEffect` 首帧绘制前锚定 + 门控冗余 50ms `scrollToBottom`;`estimateSize` 改滚动平均。⚠️ 与 REQ-031 共享 `estimateSize` 改动面(F3 为其铺部分地基),建议 REQ-032 先做 |
| REQ-041 | 聊天消息列表迁移 virtua 消除翻页抖动 | P0 | v0.8.6 | fix | released | self | [spec](../superpowers/specs/2026-07-17-req041-virtua-migration-design.md) · [plan](../superpowers/plans/2026-07-17-req041-virtua-migration.md);根因 react-virtual 异步 measureElement 两次 commit,补偿层(RAF/RO/C/批次)全证伪;改 virtua VList(flow+delta 同帧补偿)。Archie electron 已验:翻页不抖+持续加载 |

### 🐛 kanban 自驱可靠性(dogfood @ 2026-07-12 发现)

> 用 kanban 自己跑了一个 schedules UI 任务,agent 在隔离 worktree 10 分钟产出 commit `105ed2c`(已 cherry-pick 落 main `073b730`)。过程中暴露 3 个自驱链路 bug。来源 self(dogfood 实测)。

| ID | 标题 | P | 类型 | 状态 | 来源 | 备注 |
|----|------|----|------|------|------|------|
| REQ-034 | kanban aux flags 不实时更新(agent 进度 UI 不可见) | P1 | fix | ready | self | 2 次 dogfood 系统性确认;queryClaudeSDK events 没经 RunnerWriter→auxBridge |
| REQ-035 | kanban worktree 装 node_modules(junction) | P1 | fix | done | self | ✅ d5af7fe 已修 + dogfood task 3 实测 junction 生效(worktree node_modules→主 repo) |
| REQ-036 | kanban worktree HEAD 与 task.worktreeBranch 不一致 | P3 | fix | ready | self | **降级**:dogfood task 2/3 两次未复现(HEAD 正确),疑 task 1 agent 偶发 git checkout;非 worktree-setup 系统性 |
| REQ-037 | kanban agent stage 无超时,偶发挂死(prompt 后静默) | P1 | fix | ready | self | claude-sdk.js:692 for-await 无超时;CLI 子进程偶发挂→永远等;task 3 卡 17min |

> ⚠️ REQ-033 编号疑被 `.claude/worktrees/req033-in-app-browser` 占用(未正式入池),本次跳过;待 Archie 确认。

#### REQ-034 四要素
- **背景**:dogfood 实测——agent 全程在 worktree 写码 + commit,但 `task.auxFlags` 全程全 false、`updatedAt` 卡在建任务时刻,UI 徽章看不到任何进度。根因:`runner.spawnFn = queryClaudeSDK`(进程内 claude SDK),SDK 的 events(thinking / tool_use / TodoWrite / Plan)没经 `RunnerWriter` → `auxBridge` 桥接到 `task.auxFlags`。aux-bridge 依赖 provider emit 细粒度 events,claude SDK 路径 emit 缺失或 writer 未转发。
- **目标**:agent 执行过程中 auxFlags(hasPlan/hasTodos/hasTask/askUserWaiting/sessionError)实时反映;UI 徽章 + updatedAt 随 agent 事件推进。
- **范围**:主改 `runner-writer.ts` + `aux-bridge.ts` + `claude-sdk.js` 的 event emit/转发。对照 MindFS `appcontext.go:805-869` aux 桥接。不改 store schema(aux 列已在)。先实测确认 queryClaudeSDK 是否 emit events、writer 是否接。
- **验收草稿**:① 建 agent 任务,跑过程中 UI aux 徽章实时变化(TodoWrite→hasTodos 亮、出错→sessionError 亮);② `task.updatedAt` 随事件推进;③ 既有 145 测试不回归。

#### REQ-035 四要素
- **背景**:dogfood 实测——worktree `ensureWorktree` 只 `git worktree add`,不装依赖。worktree 里无 node_modules,agent 跑 `npx tsc --noEmit` / `npm run build` 必失败(无 typescript/vite)。本次 agent 跳过验证直接 commit(代码碰巧 TS 干净),真任务会带错上线。
- **目标**:worktree 创建后 agent 能跑 typecheck/build/测试(node_modules 就绪)。
- **范围**:`worktree-setup.ts` ensureWorktree 创建后装依赖。方案选型:① junction 主 repo node_modules(秒级,Windows 跨盘限制);② worktree `npm install`(慢,干净);③ 链 + 按需装。better-sqlite3 native ABI 跨 worktree 处理。
- **验收草稿**:① 建任务→worktree 有 node_modules→agent `tsc` 能跑;② 并发 2 任务 worktree 不冲突;③ 创建时延可接受(<30s 或秒级链)。

#### REQ-036 四要素
- **背景**:dogfood 实测——`task.worktreeBranch = kanban/1-ac51ed64`、agent commit `105ed2c` 在该 branch,但 worktree 实际 `HEAD = main`、SchedulesDialog 不在 working tree。worktree-setup 的 `git worktree add` branch checkout 逻辑有误,或 agent 执行中切了 branch。导致 worktree 内容与 task.worktreeBranch 不一致,merge 时混乱。
- **目标**:worktree HEAD 与 task.worktreeBranch 恒一致;agent commit 在正确 branch;working tree 含 agent 改动。
- **范围**:`worktree-setup.ts` 的 `git worktree add` 命令(`-b <branch> <base>` 构造)+ 排查 agent 执行中是否 checkout 别处。
- **验收草稿**:① 建任务后 `git -C worktree branch --show-current == task.worktreeBranch`;② agent commit 后 HEAD 仍在 branch、working tree 含改动;③ task 终态 worktree 可正确清理。

#### REQ-037 四要素
- **背景**:dogfood task 3/4(agent stage)prompt 后零产出零 event(session 只有 prompt 无 assistant),静默挂死。**根因(经 task 5 确认)= GLM 代理**:planrla server 继承环境 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721`(GLM 代理)+ `DEFAULT_*_MODEL_NAME=glm-5.x`,`claude-sdk.js:160` 把 `...process.env` 全传给 SDK → spawn 的 claude CLI 走 GLM → **GLM 对工具密集的 agent 任务(tsc+test+MCP task_next)塌方挂死**(参见 memory [[planrla-glm-proxy-tool-failure-rootcause]])。task 1/2(简单镜像,工具少)GLM 勉强能跑;task 3/4(4 阶段+tsc+MCP)塌。**task 5 重启 server 清 GLM env 后,4 阶段流水线完整跑通(success)**,100% 确认根因。`claude-sdk.js:692` for-await 无超时只是放大症状(挂死不报错、不限时)。
- **目标**:agent stage 不会因 GLM/代理塌方而静默挂死;agent 任务走真 Anthropic(不继承宿主 GLM env);挂死有超时兜底 + aux.sessionError 可见。
- **范围**:① **`claude-sdk.js` 或 runner spawn 时 env 剖离 GLM**——`mapCliOptionsToSDK` 的 `sdkOptions.env` 不传 `ANTHROPIC_BASE_URL`/`DEFAULT_*_MODEL_NAME`(或 planrla 为 agent 配独立的真 Anthropic key),主 chat 保留 GLM;② **runner stage 超时兜底**(`Promise.race` 默认 10min → abort + `updateTaskAuxFlags({sessionError:'stage timeout'})` + task fail + worktree 清理);③ CLI 子进程 stderr 捕获到 server 日志。推荐 ①+②(① 治本+② 兜底)。
- **验收草稿**:① 在 GLM 代理环境下建 agent 任务 → 不挂(agent 走真 Anthropic);② 模拟 spawn 不 yield → stage 超时触发 → task fail + worktree 释放 + aux.sessionError='stage timeout';③ 主 chat 仍走 GLM(剖离只影响 agent);④ server 日志含挂起子进程 stderr。

## Parked(暂搁,不进近期队列)
| ID | 标题 | 来源 | 搁置原因 |
|----|------|------|----------|
| REQ-006 | License 试用/离线授权 | self | 商业化,等核心锁型(M6 阶段) |
| REQ-007 | 桌面更新渠道(stable/beta/internal) | self | 商业化,等核心锁型(M6 阶段) |
| REQ-015 | 跨对话上下文共享(母,L2/L3/C3/C4 后续阶段) | self | 首切片拆为 REQ-016 先行;母条目剩余阶段待 REQ-016 落地后再排 |
| REQ-022 | 对齐 Codex 全特性集(母) | align:codex | **需先做 Codex 特性审计 → Archie 标优先级**,再拆子 REQ;UX 子集已拆 REQ-021 可先行 |

## Blocked(冻结/待想清楚)
| ID | 标题 | P | 类型 | 状态 | 冻结原因 | 设计结论(brainstorm) |
|----|------|---|------|------|----------|----------------------|
| _(暂无)_ | | | | | | |

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
| REQ-035 | kanban worktree 装 node_modules(junction) | v0.8.3 | _(dogfood task 2 修 `d5af7fe` + task 5 实测 junction 生效;含 removeWorktree inverse)_ |

> 注:v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 已含的其他完成项(桌面体验默认值 / 自绘标题栏 / 三态主题 UI / fr i18n / 项目性能优化 / 发版流程基建)未逐条回填 BACKLOG,见 CHANGELOG.md 与 `V1_PRODUCT_ROADMAP.md`「P0 完成记录」。后续如需精确追溯再补 REQ。
