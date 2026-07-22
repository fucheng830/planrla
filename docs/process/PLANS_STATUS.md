# 计划梳理报告(2026-07-15)

> 任务:梳理未完成的计划(kanban task #7)。
> 方法:交叉核对 `BACKLOG.md`(SSOT)、`docs/superpowers/specs|plans/`、`docs/process/releases/`、git tag/branch(`git merge-base --is-ancestor <commit> <tag>` 验证是否真进版)。
> 结论速览:**BACKLOG 大面积失真**——3 个已发版需求仍挂在 ready/spec,1 个已实现需求卡在 feature 分支未合并。真正"未完成"的需求收敛到 9 个,其中 5 个可立即动工。

## TL;DR

| 真实状态 | 数量 | 需求 |
|---|---|---|
| ✅ 已发版但 BACKLOG 误标未完成 | **3** | REQ-029 / REQ-031 / REQ-032 |
| 🔀 已实现、卡在 feature 分支未合并 | **1** | REQ-030 |
| 📋 spec/plan 就绪、可执行 | **2** | REQ-020 / REQ-027(待验收) |
| 🟡 ready(四要素齐、待规格化) | **3** | REQ-034 / REQ-036 / REQ-037 |
| ⬜ backlog(未细化) | **4** | REQ-005 / REQ-009 / REQ-021 / REQ-028 |
| 🧊 parked / blocked | **5** | REQ-006 / 007 / 015 / 022 + 无 blocked |

---

## A. 误标为未完成、实则已发版(优先回填 BACKLOG)

> 这 3 条是本次梳理最重要的发现:代码早已随 v0.8.3/v0.8.4 发版,BACKLOG 却仍挂在 ready/spec,造成"未完成计划"虚高。

| ID | 标题 | BACKLOG 旧状态 | 真实状态 | 发版 | 证据 |
|----|------|--------------|---------|------|------|
| **REQ-029** | loadEarlier 翻页 scroll 位置保持(RAF 补偿) | ready(且被误编为 "REQ-030") | **released** | v0.8.3 | merge `55d9b3e` + impl `6da1520`,均为 v0.8.4 tag 祖先(v0.8.3 起在) |
| **REQ-031** | 对话底部大片留白(virtualizer 高度虚高) | ready | **released** | v0.8.4 | `2446ba3`/`0d70ca0`,在 v0.8.4 tag;v0.8.4 release notes 已注明"BACKLOG 条目置 released 待顺手改" |
| **REQ-032** | 消除初始滚动冲底(F1 首帧锚定 + F3 estimateSize 滚动平均) | spec | **released** | v0.8.3 | merge `9c68f47` 在 v0.8.3 tag;代码见 `useChatSessionState.ts:428-467` + `ChatMessagesPane.tsx:127-187` |

**处理**:本次已把这 3 条移入 BACKLOG `Released` 区(见提交 diff),并清掉 `Ready` 区的 stale 条目与编号冲突告警。

---

## B. 已实现、卡在 feature 分支未合并

| ID | 标题 | BACKLOG 旧状态 | 真实状态 | 分支 | 备注 |
|----|------|--------------|---------|------|------|
| **REQ-030** | AI 自动重命名(10 轮触发) | spec | **doing/review**(实现完,待合并验收) | `feat/req030-auto-rename`(main..tip = 5+ commits) | `5f513cf` spec/plan + `09c7a81`/`7fe1d25`/`339c837`/`a389457` 等 server+chat 实现;另有 `3dfc797`/`5d0bcc3`(silent turn 过滤,Task 7 review)。**未在 main、未进任何 tag**。 |

**附带数据问题(已修)**:BACKLOG 第 61 行 spec 链接原指向 `2026-07-11-req029-ai-auto-rename-design.md`(文件名 req029),实际文件是 `req030-...`——断链,本次已改正。

**下一步**:Archie 决策——走验收三道门合并入 main,还是继续停在分支。spec 链接:`2026-07-11-req030-ai-auto-rename-design.md` · plan:`2026-07-11-req030-ai-auto-rename.md`。

---

## C. spec / plan 就绪、可直接执行

| ID | 标题 | 状态 | 下一步 |
|----|------|------|--------|
| **REQ-020** | A2A 双向节点(Google 标准) | spec(S1 client 工具) | S1 spec 已评审,**S1 待 writing-plans**;S2(server 端点)/ S3(内部协作)在后。当前**无任何代码**(`grep a2a/A2A/agent_card` 空)。 |
| **REQ-027** | UX 对齐 Codex · 渲染层交互(diff 高亮 + plan 展示 + diff 评论) | review | spec + plan 齐代码已落(随 v0.8.0 发),BACKLOG 标 review——若已实测通过可置 accepted/released。 |

---

## D. ready(四要素齐、待规格化)

> 全部来自 kanban dogfood @ 2026-07-12 暴露的自驱可靠性问题。

| ID | 标题 | P | 状态 | 根因摘要 |
|----|------|---|------|---------|
| **REQ-034** | kanban aux flags 不实时更新 | P1 | ready | 进程内 claude SDK 的 events 没经 `RunnerWriter`→`auxBridge` 桥接 |
| **REQ-037** | kanban agent stage 偶发挂死 | P1 | ready | **根因 = GLM 代理**(agent 继承宿主 `ANTHROPIC_BASE_URL=15721`)→ 工具密集任务塌方;修方向:spawn env 剖离 GLM + stage 超时兜底 |
| **REQ-036** | kanban worktree HEAD 与 task.worktreeBranch 不一致 | P3 | ready | dogfood task 2/3 两次未复现,降级 P3,疑 agent 偶发 checkout |

---

## E. backlog(未细化,待四要素)

| ID | 标题 | P | 类型 | 来源 | 备注 |
|----|------|---|------|------|------|
| **REQ-009** | 项目级工作台(需求/方案/任务/验收/归档) | P1 | feat | self | **产品同名核心,最大战略价值**。含 REQ-014(右键新需求入口)+ REQ-019(Kanban 维度待澄清)。见 `PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md` |
| **REQ-021** | UX 对齐 Codex(动效 + 网页/图片预览 + 交互优化) | P1 | feat | align:codex | REQ-027 是其首切片(已在 review);母项 REQ-022 parked |
| **REQ-005** | Provider 诊断面板 | P1 | feat | self | M3 里程碑 |
| **REQ-028** | Grok Build CLI provider(SuperGrok OAuth) | P2 | feat | self | spike 已定方向 v2:走 CLI agent provider(第 6 个,仿 opencode spawn),非 http 异类 |

---

## F. 建议下一步优先级

1. **回填 BACKLOG(本次已做)**:REQ-029/031/032 → Released;REQ-030 状态校正 + 断链修复;清编号冲突告警。SSOT 重新可信。
2. **REQ-030 合并验收**:实现已在分支,价值高(自动重命名是高频体验),走三道门并入 main,攒下一个 minor(v0.9.0)。
3. **REQ-037 + REQ-034(kanban 自驱可靠性,P1)**:kanban 要真正可信地自驱,这两个是拦路虎;REQ-037 剖离 GLM env 是治本。建议作为 kanban 稳定化主题优先排。
4. **REQ-020 S1 plan**:A2A 是协作/商业化的基础设施,S1 spec 已就绪,补 writing-plans 即可派 subagent。
5. **REQ-009(项目工作台)**:战略核心,但范围大,建议单列 brainstorming 周期,不与上面的小切片混发。

## 附:梳理中对 BACKLOG.md 的改动

- `Ready` 区:移除 stale 的 "REQ-030 loadEarlier"(实为 REQ-029,已发版)与 REQ-031(已发版 v0.8.4),清掉对应四要素块与编号冲突 ⚠️ 告警。
- `Backlog / 独立基础设施` 区:REQ-032(spec→released,移出)、REQ-030(spec→doing,补分支说明 + 修断链)。
- `Released` 区:补 REQ-029(v0.8.3)、REQ-031(v0.8.4)、REQ-032(v0.8.3)。
- 数据问题:`In Progress` 区 REQ-023(accepted,v0.6.2 已发)建议下次顺手移 Released——本次未动(状态本身不假,仅分区)。
