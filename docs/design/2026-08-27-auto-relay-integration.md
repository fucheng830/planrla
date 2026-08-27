# 自动接力联调 · 技术方案 v2（增量）

> kanban task #2 · 阶段「技术方案」 · 2026-08-27
> 任务行 a5fb5150-a54d-4808-8d08-0e89c7fac37a 已于当日 10:45 在本机库被删除（tombstone 在案）——本文档为该阶段的续存落盘产物，供后续「开工/测试验证」阶段直接使用。
> 目标仓库：`C:\workspace\项目\planrla` @ main `b236dc4`（origin 暂不可达：代理 127.0.0.1:7897 连不上，本地领先提交未推送）
> 前案：`docs/design/2026-08-27-retry-chain-integration.md`（失败重试链路；其 P0 已由 f04d7ed 采纳落地）

## 1. 结论先行

「自动接力」的主体功能**已经在本仓 main 落地**：b236dc4「全自动接力三件套」（2026-08-27 10:46，+80/−4）。因此本方案不是从零设计，而是：

1. 对已落地链路做代码级核实（§2）；
2. 追认/补齐架构决策（§3）；
3. 清剩余缺口——唯一硬缺口是 **deleteTask 不中止在跑的 agent**（本日已第三次实证，见 P0-1 与风险 R1）；
4. 给出全自动语义下的真机联调用例矩阵 v2（§5），收口「联调」二字；
5. 风险与缓解（§6）。

## 2. 现状链路核实（代码级，全部实读复验）

| 环节 | 实现位置 | 行为 |
|---|---|---|
| 创建入列 | `server/modules/kanban/service.ts:64-66` | 首 stage `autoAdvance=true` → 直接 `queued` 开跑；`false` → `waiting_user` 等 人（sdlc-default 取后者：需求设计先经人工确认） |
| seed 默认 | `assembly.ts:79` | agent 阶段 seed 即 `autoAdvance:true` + `agentCanControlStage:true` |
| 阶段接力 | `runner.ts:174-194` | 完成事件驱动 `onComplete` → 校验未被自推/非终态 → `service.next` 接力；与 MCP `task_next` 自驱形成双保险，守卫（180-183）保证不双跳、不动别人推进过的格子 |
| 超时自动重试 | `runner.ts:236-250` | 仅超时类（`timed out`）；`task_auto_retried` 事件判重（**once-per-task**）；fresh 语义（清 `provider_session_id`+`sessionError` → 回 `queued` → 惰性 `schedulerDep().schedule()`） |
| 二次超时 | 同上 fallback | → `service.fail` 转人工，接入既有失败处理链 UI |
| 交付文档 | `assembly.ts:92` + `kanban.routes.ts:210-222` + `src/components/kanban/api.ts:99-101` + `WorkflowPage.tsx:78,102` | 交付提示词要求写 worktree 根 `DELIVERY.md`；`GET /tasks/:id/delivery-doc` 读取，无文件 404 友好降级；交付面板顶部渲染 |
| 本机存量模板 | `~/.planrla/kanban-templates/task_template-sdlc-default.json` | 已同步翻转：agent×4 全 `autoAdvance=true`，stage0 user 保持 `false` ✓ |

测试基线：`npm run test:kanban` 于 HEAD=b236dc4 实跑 **210 pass / 0 fail**（2026-08-27，非转述）。

## 3. 架构选型（追认 + 本次新决策）

延续既有方向：**确定性状态机持有接力正确性，LLM 只做阶段内工作，不引入任何调度型 LLM/外部队列**。

- **D4（追认，b236dc4 已选）**：拒绝 LLM 调度 agent——状态机正确性留在确定性代码，模型判断力留在执行 agent。relay 由「完成事件驱动 next」这条确定性路径完成，`task_next` 只是冗余保险而非依赖项。
- **D5（追认）**：自动重试限定「仅超时类 + once-per-task」。成本上限=每任务至多一次免费重试；语义类失败（prompt/环境缺失等确定性错误）即时转人工，烧钱循环结构性不可能。
- **D6（追认）**：`autoAdvance` 回落推进与 MCP `task_next` 自驱并存，onComplete 守卫负责互斥——谁先动算谁的，另一个看到已位移即退出。
- **D7（新，建议采纳）**：**首阶段人工闸保留**。全自动从「人工确认需求原文」之后起算（创建 → stage0 等人 → 放行后无人值守到底）。这正是 9998167 已验收过的「创建→确认→自驱→终态」心智，也是对 R2 成本失控的第一道结构性护栏。「创建即跑」如需，改一处模板字段即可，不必现在放开。

## 4. 改动点（增量）

### P0 必改

| # | 缺口 | 改法 | 量级 |
|---|---|---|---|
| P0-1 | **deleteTask / cancel 不中止在跑的 agent**。今日实证：同一需求的多个任务化身（dd4886d5 等）被删后其 agent 仍跑到超时才终局；本文档自身的任务行 10:45 删除、其 agent 化身即在运行——活体孤儿第三例 | runner 侧登记可中止句柄（AbortController / provider 子进程组），`store.deleteTask` 与 `service.cancel` 经回调统一触发 abort；顺手打通 background-tasks registry 的 `stopTask` 展示位 | ~40 行 server |

### P1 建议

| # | 缺口 | 改法 | 量级 |
|---|---|---|---|
| P1-1 | 自动接力无总开关——想回到全手动的机器没有退路 | app_config / env `KANBAN_AUTO_RELAY=off` 时 onComplete 回落不自动 `next`（`task_next` 手推不受影响） | ~10 行 |

### P2 可选（工期紧可砍）

| # | 内容 | 量级 |
|---|---|---|
| P2-1 | `tasks.attempts` 列（前案 P2-1/P2-2 未实施）retry/自动重试时自增，失败卡显示「第 N 次」 | ~8 行 |
| P2-2 | 超时判定错误码化（结构化 errCode 替代 `includes('timed out')` 串匹配） | ~10 行 |

**跨机说明**：模板 JSON 按机落盘、不参与 team-sync。其他机器升到此版后需手动翻转模板 flags 或删 `~/.planrla/kanban-templates/` 让 seed 重生——进交付说明，不算缺陷。

## 5. 真机联调用例矩阵 v2（R 系列，供「开工/测试验证」）

前案 T1-T4/T6 自动件已随 f04d7ed 入库；以下是全自动语义下的增量用例：

| # | 场景 | 步骤 | 通过标准 |
|---|---|---|---|
| R-T1 | 全链无人值守 | 小需求真实任务（超时配置充裕），人工放行 stage0 后不再干预 | 四个 agent 阶段连续推进至 success；事件序 `agent_stage_started/completed` + 阶段推进严格步进，currentStageIndex 单调 +1 无跳变 |
| R-T2 | 超时一次自愈 + 二次转人工 | `KANBAN_STAGE_TIMEOUT_MS=8000` + 必然超时的 stage | 第 1 次：`task_auto_retried` 事件 + 自动续跑 fresh 会话；第 2 次：→ fail + 失败卡「重试/取消/转同事」可用 |
| R-T3 | 双保险竞态 | autoAdvance 开启且 prompt 明确要求调用 `task_next` | 仍严格步进（不跳级、无双 running 段）；对已删/终态任务 MCP 调用报 not found 快速失败 |
| R-T4 | 删除运行中任务 | P0-1 后：创建任务即刻 DELETE | agent 进程秒停、worktree 清理、时间线无 post-delete 写入；修复前的现行行为留档为已知缺陷基线 |
| R-T5 | 崩溃恢复交互 | 阶段运行中 kill server → 重启（zombie 恢复续跑）→ 再制造一次超时 | zombie 续跑不消耗自动重试额度；恢复后的首次真实超时仍享 once-per-task 自动重试 |
| R-T6 | 多实例实时性 | 第二浏览器同 root 观察全自动走列 | 卡片实时迁移、消息盒子 running/waiting 类目同步更新 |
| R-T7 | DELIVERY.md 闭环 | 完整走到交付阶段 | worktree 根生成文件、交付面板顶部渲染；树清理后接口 404 且 UI 显示友好降级文案 |

环境纪律沿用前案 §5：联调前 `netstat -ano | findstr :3001/:3011` 排查陈旧 tsx 进程；kill 用大小写敏感匹配，防误杀 v1 Electron。

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 孤儿 agent：删/取消的任务其进程继续写事件、占槽位、烧 token 至 60min 超时档 | 高 | **P0-1**；修复前手工补救路径=等待自然超时或在后台任务面板手动 stop |
| R2 | 无人值守整链成本（claude 每阶段 $0.2+ × 60min 档） | 中 | D5 结构性封顶；D7 首闸前置；P1-1 总开关兜底；模板 maxConcurrency 限并发 |
| R3 | `'timed out'` 串匹配脆弱（provider 改文案即失灵→漏重试退回人工，方向安全） | 低 | 失灵后果只是少一次自动重试；P2-2 错误码化根治 |
| R4 | task_next 与完成回落竞态致 stageIndex 异常 | 低-中 | 守卫已在位（runner.ts:180-183）；R-T3 显式断言，跑绿才算数 |
| R5 | 全自动使 running 任务密度上升，消息盒子/AI 请求列表变吵 | 低 | 类目映射既有（waiting→待处理、running→AI 请求）；先观察不加过滤 |
| R6 | origin 不可达（代理 7897 未通），领先提交滞留本地 | 环境 | 代理恢复后 `git fetch --dry-run` 核对再推；期间基线固定 b236dc4 |
| R7 | runner/service 为高频合流区，与他人并行改动冲突 | 低 | 各改动 ≤50 行独立提交；husky lint-staged 故障期维持手动 eslint + `--no-verify` 惯例 |

## 7. 验收标准

- [ ] P0-1 合入并通过 R-T4（附 before/after 时间线对比）；
- [ ] R-T1 / R-T2 / R-T7 真机各留一段执行记录（命令 + 观察）；
- [ ] `npm run test:kanban` 全绿（现基线 210，新增用例向上累加）；
- [ ] 触碰 TSX 的改动贴 `npx tsc --noEmit` 输出；
- [ ] D7（首阶段人工闸保留）获 fucheng 点头，或看板默认放行视为接受。
