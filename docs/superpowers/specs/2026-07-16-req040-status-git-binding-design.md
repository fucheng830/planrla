---
REQ-ID: REQ-040
标题: 状态机↔git 自动绑定 + BACKLOG 状态校验工具(check-req-status)
日期: 2026-07-16
状态: spec(设计已批准,转入 writing-plans)
类型: feat
---

# REQ-040 状态机↔git 自动绑定 + BACKLOG 状态校验工具

## 1. 背景

planrla 的需求状态机(`backlog→ready→spec→plan→doing→review→accepted→released`)全写在 `docs/process/BACKLOG.md`,是手动维护的 SSOT,与 git(commit / tag / branch)**零自动绑定**。

2026-07-15 的 `PLANS_STATUS.md` 梳理暴露了失真:3 条已发版(REQ-029/031/032)仍挂 ready/spec、1 条(REQ-030)实现完卡 feature 分支未合并、编号冲突(REQ-029 误编 030)、spec 链接断链、REQ-038 有 spec 无 BACKLOG 条目。Archie 花整次会话纯对账(交叉核对 BACKLOG × specs/plans × releases × `git merge-base --is-ancestor`),**产出零代码价值**。

根因:状态流转靠人手改 markdown,无机制验证"标 released 的需求其 commit 是否真在某 tag 内"。这是开发流程三类人工里的**对账人工**(纯浪费),也是 v0.9"看板收口"的治理地基——kanban runner 自驱的前提是信任地知道任务真实状态,现在连人都搞不清。

> 战略关联:此项是 `2026-07-16-planrla-moat-roadmap.md` v0.9 的盲点补入。原 roadmap v0.9~v2.0 未列,2026-07-16 流程卡点诊断识别为 ROI 最高、零风险的一刀。

## 2. 目标与非目标

**目标**
- 每条 REQ-NNN 的状态可从 git 自动推导/校验。
- `PLANS_STATUS` 式梳理从"整次会话"降为"一键查询"(一条 npm 命令)。
- 消除纯对账人工。

**非目标(不做)**
- 不改 BACKLOG SSOT(纯只读)。
- 不改发版流程、不改 commit message 约定(吃现有)。
- 不集成看板 UI(v2)。
- 不自动修编号冲突(只报告)。

## 3. 关键决策(已批准)

| 决策 | 结论 | 理由 |
|---|---|---|
| SSOT 写权限 | **纯只读报告** | MVP 先证明校验准确,再谈自动化。机器不动 SSOT,零风险。符合 YAGNI。 |
| 形态 | **CLI 一次性**(MVP) | 常驻集成要改显示层,与"先验证准确性"相悖。放 v2。 |
| 数据源 | **git 单一真相** | PLANS_STATUS 教训 = BACKLOG 和 releases 都失真,只有 git 客观。用 git 校验人工才叫自动绑定;用 releases 校验 BACKLOG 是人工对人工。 |

## 4. 数据源探索(可行性依据)

- git 历史里 **92 条** commit message 含 `REQ-`,约定稳定:`fix(scope): REQ-NNN ...` / `chore(merge): 合入 REQ-NNN ...` / `chore(release): vX.Y.Z`。→ 绑定主路径天然成立,**不需要新约定**。
- 双重真相源:机器真相(git tag + commit grep,客观) vs 人工真相(`releases/*.md`「含需求」段 + BACKLOG 状态列,可能失真)。工具核心 = 拿前者校验后者。
- 范例发现:tag 列表里 **v0.8.2 缺失**(有 `chore: bump 0.8.2` commit `ecd47c0` 但无 tag,v0.8.1 直接跳 v0.8.3)。
- 同类脚本先例:`scripts/sync-native-abi.js`、`scripts/publish-r2.js`(单文件 node 脚本)。

## 5. 数据流与算法

```
BACKLOG.md ──parse──> {REQ-NNN → 声称状态 + 声称版本}   ─┐
                                                         │ compare → 偏差清单
git ──grep/tag──────── > {REQ-NNN → 真实位置}           ─┘
```

**真实位置推导**(每条 REQ-NNN):
1. `git log --grep="REQ-NNN" --format=%H` → 该 REQ 的所有 commit hash。
2. 每个 commit 查询:
   - `git tag --contains <hash>` → 进了哪些 tag。
   - `git merge-base --is-ancestor <hash> main`(exit code)→ 是否进 main。
   - `git branch --contains <hash>` → 在哪些分支(检测未合并的 feature 分支)。
3. 推导规则(优先级从高到低):
   - commit 进了某 tag → `released@<最高版本 tag>`
   - 在 main 但无 tag → `unreleased-in-main`(做完没发)
   - 只在 feature 分支(不在 main、不在 tag)→ `stranded-in-<branch>`
   - 无 commit → `no-commit`(backlog/ready,或编号孤儿)

## 6. 偏差类型(工具输出价值核心)

| 类型 | 含义 | 现存范例 |
|---|---|---|
| `MISLABEL` | BACKLOG 声称状态 ≠ git 真相 | REQ-029/031/032(标 ready/spec 实则 released) |
| `STRANDED` | 有 commit 但卡 feature 分支未进 main | REQ-030 |
| `ORPHAN` | 有 spec/plan 文件但 BACKLOG 无条目 | REQ-038 |
| `SPEC-GAP` | BACKLOG 有条目但无 spec/plan | (可能) |
| `TAG-DRIFT` | commit message 提到 vX.Y.Z 但无对应 tag | v0.8.2 |
| `ID-CONFLICT` | 编号被多条 BACKLOG 条目占用 | REQ-030(loadEarlier vs 自动重命名) |
| `UNTRACKED-FEAT` | `feat/fix:` commit 不带 REQ-NNN(漏标启发式) | (扫历史) |

> `TAG-DRIFT` / `UNTRACKED-FEAT` 为启发式,可能误报,flag 出来由人确认。

## 7. 组件设计

MVP 单文件 `scripts/check-req-status.js`(对齐 `scripts/sync-native-abi.js` 风格,预估 ~350 行,内部函数分区,边界清晰):

- **解析层**
  - `parseBacklog(md)` → `[{id, title, claimedStatus, claimedVersion}]`(扫 BACKLOG.md 所有表格行,正则 `REQ-\d{3}`)
  - `parseSpecsPlans()` → 扫 `docs/superpowers/{specs,plans}/` 文件名/frontmatter,提取 REQ-NNN → 文件列表(供 ORPHAN / SPEC-GAP 检测)
- **git 层**(每个函数单一职责,可 mock)
  - `gitReqCommits(reqId)` → commit hash 列表
  - `commitLocations(hash)` → `{tags:[], inMain:bool, branches:[]}`
  - `tagList()` → 排序后的 tag 列表
- **校验层**
  - `deriveTruth(reqId)` → 真实状态(组合 git 层)
  - `compare(claimed, truth)` → 偏差对象
- **输出层**
  - `formatReport(deviations)` → 人类可读 stdout;`--json`(机器读)/`--md`(写 Markdown 报告)可选
- **入口**:parse argv → 跑校验 → formatReport → 设退出码

## 8. CLI 接口

```bash
npm run check:reqs                         # 全量校验,人类可读报告
node scripts/check-req-status.js --req REQ-030   # 单条诊断(详出该 REQ 的 commit/tag/branch)
node scripts/check-req-status.js --json    # 机器读(CI/钩子用)
node scripts/check-req-status.js --md > docs/process/REQ_STATUS.md  # 导出报告
```

`package.json` 加 `"check:reqs": "node scripts/check-req-status.js"`。

## 9. 输出格式(样例)

```
REQ 状态校验 (git 单一真相) — 共扫 40 REQ,检出 6 偏差:

[MISLABEL]    REQ-029  ready  → released@v0.8.4   (6da1520 ∈ tag v0.8.4)
[MISLABEL]    REQ-031  ready  → released@v0.8.4   (2446ba3 ∈ tag v0.8.4)
[MISLABEL]    REQ-032  spec   → released@v0.8.3   (9c68f47 ∈ tag v0.8.3)
[STRANDED]    REQ-030  有 commit 卡 feat/req030-auto-rename (未进 main)
[ORPHAN]      REQ-038  有 spec/plan 无 BACKLOG 条目
[TAG-DRIFT]   v0.8.2   有 "chore: bump 0.8.2"(ecd47c0) 但无 tag (v0.8.1→v0.8.3)
[ID-CONFLICT] REQ-030  编号被 loadEarlier / 自动重命名 同时占用

exit 1 (有偏差) · BACKLOG SSOT 未改动
```

## 10. 错误处理与退出码

- 非 git 仓库 / 不在 planrla 根(cwd 找不到 `docs/process/BACKLOG.md`)→ stderr 报错,exit 2。
- `git` 子命令失败 → 透传 stderr,exit 2。
- BACKLOG 解析失败(markdown 格式破坏)→ 报具体行号,不静默继续,exit 2。
- `REQ-\d{3}` 严格正则,避免 `REQ-01` 误匹配 `REQ-010`。
- **业务退出码**:有偏差 exit 1(便于将来挂 pre-push hook / CI gate);无偏差 exit 0。

## 11. 测试策略(dogfood 自验证)

- **单测** `scripts/check-req-status.test.js`(仿 `scripts/publish-r2.test.js` 位置):
  - `parseBacklog`:喂样例 markdown 片段,断言提取的条目。
  - `deriveTruth`:注入 mock 的 `commitLocations`,断言状态推导(released/unreleased/stranded/no-commit 四分支)。
  - `compare`:喂 claim + truth 对,断言偏差类型判定。
- **e2e 夹具 = 当前仓库**:验收标准①直接要求工具抓出 PLANS_STATUS 已知的失真条目(REQ-029/030/031/032/038 + v0.8.2 drift)。这些就是现成回归断言——工具做完跑一遍,输出能对上 PLANS_STATUS 的结论,即证明正确。这是天然 dogfood 闭环。

## 12. 范围边界

- 不改 BACKLOG(只读)。
- 不改发版流程、commit 约定。
- 不集成看板 UI(v2)。
- 不自动修编号冲突(只报告)。
- 不解析 `releases/*.md` 作真相源(v2 若做交叉校验再纳入)。

## 13. 验收标准

1. 跑 `npm run check:reqs`,正确识别 `PLANS_STATUS` 里那 5 条已知失真(REQ-029/030/031/032 误标或卡分支 + REQ-038 孤儿)+ v0.8.2 tag-drift。
2. `--req REQ-NNN` 能定位任意 REQ 在 main / tag / feature 分支的真实位置(给出具体 commit hash + tag + branch)。
3. 输出完整"BACKLOG 状态 ↔ git 真相"偏差清单,7 类偏差可识别。
4. 幂等可重跑;后续新增/发版需求,工具持续反映真实状态。
5. `npm run typecheck && npm run build` 干净(工具是 JS,但纳入项目不破坏既有 TS 构建)。
6. 单测 + e2e 夹具断言通过(`scripts/check-req-status.test.js`)。
