# 重试链路联调 · 技术方案

> kanban task #2 · 阶段「技术方案」 · 2026-08-27
> 目标仓库:`C:\workspace\项目\planrla` @ main(a7fe64c 本地领先 origin 81 提交)
> 关联提交:a7fe64c `feat(kanban): 失败任务处理链——重试/取消/转给同事,失败原因透明`

## 1. 背景与范围

a7fe64c 已落地失败任务处理链的服务端与前端最小实现(测试 208/208 绿),但**尚未做过真实端到端联调**,且存在若干语义缺口(见 §6 风险)。本阶段产出:

- 现状链路的代码级核实结论(全部经读码验证,非推测);
- 架构选型与关键决策(ADR 形式);
- 最小改动点清单(P0 + P2);
- 联调用例矩阵——供下一阶段「开工」实施、「测试验证」执行;
- 风险与缓解。

**Non-goals(本期不做):**自动退避重试策略引擎、跨机指派闭环(依赖 team-sync Phase 2 / VPS relay)、重试预算熔断、retry 的 REST→MCP 工具暴露。

## 2. 现状链路核实(代码级)

整条链路已闭环,以下为逐文件验证结果:

| 环节 | 实现位置 | 行为 |
|---|---|---|
| 失败捕获 | `server/modules/kanban/runner.ts:225-240` | spawnFn reject/超时(`stageTimeoutMs`,默认 60min,`KANBAN_STAGE_TIMEOUT_MS` 可覆盖)→ 写 `auxFlags.sessionError` → 事件 `agent_stage_failed` → `service.fail()` |
| fail 动作 | `service.ts:242-250` | `updateTaskStatus('fail')`;store 层 terminal 分支**自动清 `scheduler_admitted`**(`store.ts:139`)并写 `completed_at`;触发 `onTerminal` → `worktreeSetup.removeWorktree()`(`assembly.ts:110-114`,best-effort 异步) |
| retry 入口 | `kanban.routes.ts:241-244` | `retry` 加入 `moves` 数组 → `handleMove` 统一处理 |
| retry 语义 | `service.ts:231-241` | 仅允许 `status==='fail'`;attempt = `task_retried` 事件计数+1;清 `sessionError`;置回 `queued`。**注意:不清 `completed_at`、不动 `provider_session_id`** |
| 调度拉起 | `routes.ts:331` + `scheduler.ts:44-66` | `handleMove` 内同步 `scheduler.schedule(rootId)`;admit 条件 = queued ∧ 未 admitted ∧ 依赖全 success ∧ 模板并发槽;优先级+FIFO 排序 |
| WS 广播 | `routes.ts:332` | retry **有** `broadcastTaskUpdated`(多实例实时刷新 OK);仅桌面通知被排除(commit 所说"静默"即此,`notifyActions`,`routes.ts:335`) |
| 阶段重跑 | `runner.ts:120-158` | 重渲**原样 stage prompt**(input 回退 stage-0);**从持久化 `providerSessionId` 恢复会话续跑**(`--resume`);worktree 由 `ensureWorktree` 幂等重建(fail 时已被删) |
| 前端入口 ×3 | `api.ts:99-108` + `WorkflowPage.tsx` | ① 看板失败卡「重试此阶段/取消」② 右栏「当前需要你处理」失败卡「重试/转给同事/取消任务」③ toast+refreshAll 兜底 |

状态映射无歧义:服务端 `fail` ↔ 展示层 `failed`(`WorkflowPage.tsx:34`)。

**已核实的三个语义缺口(本方案的直接动因):**

1. **续跑×新树的矛盾**:fail 删了 worktree,retry 又重建干净树;但 runner 却恢复旧 provider 会话继续跑——agent 的上下文记忆停留在旧树状态,操作对象却是全新文件系统。
2. **`completed_at` 残留**:fail 写入后 retry 不清,queued 任务带着完成时间戳,污染后续任何按 `completed_at` 的统计/展示。
3. **「转给同事」无错误处理**:右栏用 raw `fetch('/api/team-messages')`,不检查 `res.ok`,接口失败也 toast 成功。

## 3. 架构选型

维持现有架构:**单体 Express + better-sqlite3 同步事务 + task_events 追加审计 + 内存 scheduler**,不为此功能引入新组件。

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 事件审计驱动的最小补丁(现状修补)** | 上表三缺口各 ≤20 行修复,人工触发重试保持不变 | ✅ **采纳** |
| B. 后端自动重试器(attempt 计数 + 指数退避自动 requeue) | 更像传统 retry chain,但 agent 阶段单次成本 ≈$0.2+、单阶段超时上限 60min,失败往往是确定性错误(prompt 问题/环境缺失),自动重试=烧钱循环 | ❌ 拒绝;事件里已有 attempt 字段,未来要加也有数据基础 |
| C. 外部任务队列(bullmq 等)接管重试调度 | 解耦彻底但对单机 Electron 应用是过度工程;且 zombie 恢复(`assembly.ts:176-185`)已在进程内解决"重启续跑" | ❌ 过度设计 |

### 决策记录(ADR-mini)

- **D1·重试语义 = 全新重跑(fresh)**:retry 时清空任务的 `provider_session_id`,让 runner 以全新 provider 会话在重建的 worktree 上重跑当前阶段。旧会话在 provider 侧与 `task_events` 时间线中完整可溯。*备选(模板级 `stage.retryMode: 'resume'` 开关)暂不做*,fucheng 若要"失败后续跑"语义再立项——默认值按 fresh 上线。
- **D2·人工触发为准绳**:重试是人的决策(看板按钮),本期不做任何自动触发路径。
- **D3·attempt 可视化走列冗余**:`tasks.attempts INTEGER DEFAULT 0`,retry 时 `+1`,列表页零额外查询即可显示「第 N 次」;不靠 events 反查(N+1)。

## 4. 改动点

P0 = 本期必改(合计服务端 ~15 行、前端 ~8 行,符合"一个修复一次提交");P2 = 可选增强,工期紧可砍。

| # | 文件 | 改动 | 量级 |
|---|---|---|---|
| P0-1 | `service.ts` `retry()` | 追加清 `completed_at`(见 D1 附带修复 R2):通过 store 新增或复用 SQL 置 NULL | ~3 行 |
| P0-2 | `store.ts` 新增 `clearProviderSessionId(taskId)`(或将 `updateProviderSessionId` 放宽为可空参) | retry 里调用 → 强制 fresh(D1) | ~4 行 |
| P0-3 | `service.ts` `retry()` | 记录 `task_retried` 事件时带 `sessionIdCleared: true`,便于时间线追溯语义变更 | ~1 行 |
| P0-4 | `WorkflowPage.tsx` 右栏「转给同事」fetch | 加 `res.ok` 校验 + 失败 `toast.error(res.status)` | ~5 行 |
| P0-5 | 测试:`tests/service.test.ts`(或就近文件) | ① 非 fail retry→400;② retry 后 queued/admitted=0/sessionError 空/**completed_at 为 NULL**;③ 二次 fail-retry attempt=2;④ mock spawnFns 先 throw 后成功 → schedule 拉起、onComplete 自动推进、事件序 `agent_stage_failed→task_retried→agent_stage_started` | ~80 行 |
| P2-1 | `store.ts` 迁移 + `service.ts` | `tasks.attempts` 列(`migrateAddColumn` 现成模式,`store.ts:310`)+ retry 自增 | ~8 行 |
| P2-2 | `WorkflowPage.tsx` 失败卡 | 「原因」行旁显示「第 N 次尝试」(读 `attempts`) | ~2 行 |
| P2-3 | `frontend` `npx tsc --noEmit` | P0-4 触碰 TSX 后强制执行并贴输出(CLAUDE.md 责任矩阵) | 校验项 |

## 5. 联调用例矩阵(交付「测试验证」阶段执行)

T1-T4 自动化(P0-5 一并落库);T5-T9 手工真机:

| # | 场景 | 步骤 | 通过标准 |
|---|---|---|---|
| T1 | 非法状态拒绝 | 对 running/success 任务 POST `/retry` | 400 `INVALID_STATUS`,无副作用 |
| T2 | 重试字段完整性 | 单元:retry 后 status/admitted/sessionError/completed_at/attempts | §P0-5 各断言 |
| T3 | 全链集成(mock spawn)| 首 run 抛错→fail→retry→二次成功推进到下阶段 | admit 即时发生(handleMove 同步)、事件序正确、并发槽释放又占用 |
| T4 | 多任务排队 | maxConcurrency=1:A running、B failed 后 retry | B 按优先级/FIFO 等槽,不抢占 A |
| T5 | 真实端到端(真 claude CLI) | `KANBAN_STAGE_TIMEOUT_MS=8000` 起 server + 必然超时的阶段任务 | 失败卡显示原因(≈8s)→点「重试此阶段」→ 新会话在新 worktree 正常完成推进 |
| T6 | 双实例 WS 广播 | 第二浏览器开同一看板;主实例点重试 | 从实例卡片实时从「验证失败」迁出(fail 已广播,验回归) |
| T7 | 进程崩溃边界 | 阶段运行中 kill server→重启 | zombie requeue 使任务自行续跑;此后手工 fail→retry 不与之互踩 |
| T8 | 转给同事链路 | 弹窗输入名字提交 | 团队消息落库并在消息盒子可见;**断网/500 时 toast 报错而非成功**(P0-4 后) |
| T9 | 取消分支 | 失败卡「取消」 | cancelled 终态、worktree 清理日志正常、右栏卡消失 |

环境纪律(源自既往教训):联调前 `netstat -ano | findstr :3001/:3011` 排查陈旧 tsx 进程——stale-port 会让你调试一条根本没跑到新代码的实例;kill 用大小写敏感匹配避免误杀 v1 Electron。

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | Windows 文件锁致 `removeWorktree` 半失败(旧教训),retry 建 worktree 时撞残留目录 | 高 | `ensureWorktree` 本就幂等;T5 显式覆盖;清理失败已有 error log,必要时重试前人工删树 |
| R2 | fresh 语义下重复阶段会重做部分已完成工作(如已写了一半的文件) | 中 | worktree 是 fail 后全新重建的,天然规避叠加脏写;agent prompt 本身要求幂等实现,风险可接受 |
| R3 | 成本失控:用户反复手动 retry 一个确定性失败任务($0.2+/次 × 60min 超时档) | 中 | 不做自动重试(D2);P2-2 显示尝试次数形成软提醒;熔断列入 non-goals 观察 |
| R4 | 「转给同事」跨机不可见(team-messages v1 仅本地,sync Phase 2 未上) | 中 | 本期 UI 文案不变但不承诺跨机;VPS relay 上线后随 Phase 2 解决;在交付说明中注明 |
| R5 | `completed_at` 残留误导统计/P2 报表 | 低 | P0-1 本期修掉 |
| R6 | retry 与 zombie-recovery 边界模糊(重启恢复 vs 手工重试混同,审计难分) | 低 | 两者事件流不同(restart 无 `task_retried` 事件),timeline 可区分;不强改 |
| R7 | 测试基线偏移:ahead origin 81 commits,同事可能并行推 main 导致联调基线漂移 | 低 | 开工前 `git fetch` + 对比(planrla-project 惯例);联调固定在 a7fe64c 之后的本次改动之上 |

## 7. 验收标准

- [ ] P0-1..P0-5 合入,各自独立 commit,单条链路 ≤50 行;
- [ ] 服务端套件全绿且 ≥4 个新增 retry 用例;
- [ ] `npx tsc --noEmit` 输出粘贴在工作记录中;
- [ ] T5/T8 两项真机联调各留一段执行记录(命令+观察);
- [ ] fucheng 对 D1(fresh 默认)显式确认,或在看板上默认放行视为接受。
