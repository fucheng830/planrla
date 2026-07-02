# 发版全生命周期管理 设计(spec)

> **日期**:2026-07-02
> **状态**:Draft(待 Archie 审阅)
> **主题域**:process / release-management
> **关联**:`docs/product/V1_PRODUCT_ROADMAP.md`、`docs/product/PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md`、`docs/commercial/RELEASE_CHECKLIST.md`、`docs/superpowers/specs+plans`

## 1. 背景

planrla 已完成 MVP 并走通 v0.1.0 / v0.2.0 发版(桌面 Electron + Web + Android)。但「需求 → 发版」全链路缺乏统一管理,四阶段各有缺口:

| 阶段 | 已有 | 缺口 |
|------|------|------|
| 需求收集 | roadmap(M1-M6)、functional-requirements(P0-P3) | 无统一需求池(SSOT),需求散落在 roadmap P 级 + 文档 P 级 + 口头 |
| 分发任务 | superpowers `spec→plan→impl`(subagent 执行) | 无「需求→spec→plan」系统入口,每次手工起 spec,零散 |
| 验收 | plan 末尾验收清单、roadmap 验收标准 | 格式不统一、无沉淀 |
| 发版 | release-it + RELEASE_CHECKLIST + 双轨制 tag | `.release-it.json` 的 `npm.publish=true` + `tagName=v${version}` 与 package.json=1.34.0 不一致(会产出污染性 v1.34.x tag);electron-builder 需 `-c.extraMetadata.version` 补丁对齐 |

目标:加一条把现有体系串起来的链 + 一个需求 SSOT,而不是替换它们。

## 2. 目标与非目标

### 目标
- 在 `docs/process/` 沉淀一套 SOP + 模板,把「需求→分发→验收→发版」串成可追踪链
- `BACKLOG.md` 作为需求单一事实来源
- 复用 superpowers `specs/plans` 工作流,不重造模板
- 发版工具链单轨化,消除双轨制与 npm.publish 隐患

### 非目标(YAGNI,本轮不做)
- 不做发版自动化脚本 / CLI(后续增量,见 §9)
- 不做多角色团队协作功能(单人维护)
- 不替换 roadmap / functional-requirements(战略层不动)
- 不引入 GitHub Issues / 在线看板(用本地 BACKLOG.md)
- 不做 mac/linux 跨平台构建(需对应平台或 CI,本轮仅 Win)

## 3. 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 落地形态 | SOP + 模板(`docs/process/`) | 与现有体系融合,轻量,立即可用 |
| 需求池载体 | `BACKLOG.md` 单文件 | git 友好,会话内可直接读写追踪 |
| 发版节奏 | 按主题/特性集合 | 延续 v0.1/v0.2 主题化风格,版本有叙事 |
| 发版工具链 | 单轨化(去双轨) | 消除踩坑源,简化 electron-builder |
| 状态机粒度 | 8 主状态 + 2 异常 | 覆盖全流程且可追踪 |

## 4. 整体架构

### 4.1 目录结构(新增 docs/process/)

```
docs/process/
├─ README.md                  # SOP 主文档:端到端流程 + 阶段 + 责任 + 门禁
├─ BACKLOG.md                 # 需求池(SSOT,状态机驱动)
├─ templates/
│  ├─ acceptance.md           # 验收清单模板(plan 末尾嵌入用)
│  └─ release-checklist.md    # 发版清单(主题化,含单轨步骤)
└─ releases/
   └─ v0.x.x.md               # 每版本发版记录

# 复用(不重造):
# docs/superpowers/specs/    ← spec 产物(brainstorming)
# docs/superpowers/plans/    ← plan 产物(writing-plans)
# docs/commercial/RELEASE_CHECKLIST.md  ← License/签名/更新源(发版时引用)
```

### 4.2 端到端流程

```
BACKLOG.md(需求池,SSOT)
  ① 规格化:ready 条目 → brainstorming skill → spec(docs/superpowers/specs/)
  ② 拆任务:spec 评审通过 → writing-plans skill → plan(docs/superpowers/plans/)
  ③ 执行:subagent-driven-development / executing-plans → checkbox 全勾
  ④ 验收:三道门(预检+功能+回归)→ accepted
  ⑤ 收敛:攒主题 → 发版就绪检查
  ⑥ 发版:release-checklist.md → tag v0.x.x + electron-builder + 上传 Release
  ⑦ 记录:releases/v0.x.x.md + BACKLOG 条目 → released
```

### 4.3 BACKLOG 状态机

```
backlog → ready → spec → plan → doing → review → accepted → released
  (补齐四要素) (brainstorm) (writing-plans) (subagent) (三道门) (发版)
异常:blocked / dropped(任意状态可转入)
```

| 状态 | 含义 | 进入条件 |
|------|------|---------|
| backlog | 刚录入,未细化 | 新建条目 |
| ready | 待规格化 | 补齐背景/目标/范围/验收标准草稿 |
| spec | 已产出 spec | brainstorming 完成 |
| plan | 已产出 plan | spec 评审通过 + writing-plans |
| doing | 执行中 | subagent 在跑 plan |
| review | 待验收 | plan checkbox 全勾 |
| accepted | 验收通过 | 三道门全过 |
| released | 已发版 | 随某主题版本打包上传 |

BACKLOG 条目字段:`ID | 标题 | 里程碑(M1-M6) | P级(P0/P1/P2) | 类型(feat/fix/perf/refactor/docs) | 状态 | spec | plan | 版本`

## 5. 四阶段细则

### 5.1 需求收集(BACKLOG.md)

- 任何来源(口头、roadmap 拆解、bug、想法)→ PM(AI)整理成一条,自增 `REQ-NNN`
- **roadmap 不细动**,仅作分类锚:roadmap 的 P0/P1/P2 条目拆成 BACKLOG 行,带 milestone/P
- **ready gate(四要素)**:背景 + 目标 + 范围 + 验收标准草稿,缺一不进 brainstorming
- BACKLOG.md 按状态分节:`## Doing` / `## Ready` / `## Backlog` / `## Released`(条目状态变化时移节)

### 5.2 分发任务(复用 superpowers)

| 步骤 | 动作(PM 驱动) | 产物 | 状态流转 |
|------|---------------|------|---------|
| 规格化 | `brainstorming` skill | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | ready→spec |
| 拆任务 | spec 评审通过 → `writing-plans` skill | `docs/superpowers/plans/YYYY-MM-DD-<topic>-impl.md` | spec→plan |
| 执行 | `subagent-driven-development`(并行)/ `executing-plans`(单任务带 review) | plan checkbox 全勾 | plan→doing→review |

**双向追溯约束**:每个 plan 的 frontmatter 写 `REQ-ID: REQ-NNN`;BACKLOG 条目回填 plan/spec 链接。

**会话级 PM 行为**:用户说「开始 REQ-012」→ PM 检查 ready gate → brainstorming → spec 交用户评审 → writing-plans → 派 subagent。用户只在评审/决策点介入。

### 5.3 验收(三道门)

触发:状态 `review`。验收人:Archie。

| 门 | 内容 | 不通过 |
|----|------|--------|
| 预检门(自动) | `npm run typecheck` + `npm run build` + `git diff --check` 全过 | 退回 doing |
| 功能门(对照 spec) | plan 末尾验收清单逐项勾(spec 验收标准) | 退回 doing |
| 回归门(抽查) | 改动相关的既有功能没坏 | 退回 doing;严重退回 plan |

- **acceptance.md 是模板,不是独立文件**:writing-plans 产出 plan 时在末尾按模板生成验收清单;验收时直接在 plan 末尾勾 + 写结论。模板字段:预检命令 / 功能验收项(从 spec 拉)/ 回归抽查点 / 验收结论(通过·不通过 + 备注 + 验收人 + 日期)。
- 通过 = BACKLOG 置 `accepted` + plan 末尾写结论一行。失败 = 标注问题退回 `doing`。

### 5.4 发版(单轨化)

节奏:攒一组 `accepted` 条目(对应一个主题/里程碑子集)→ 发版。

**版本号规则**:
- tag 与 package.json 严格同步,`v` 前缀只在 tag
- feat 主题 → minor(v0.2.0 → v0.3.0);fix/chore → patch(v0.2.1)

**发版 SOP(7 步,固化进 release-checklist.md)**:
```
① 就绪:本主题 BACKLOG 条目全 accepted + main 干净 + 预检过
② 版本号:定 minor/patch
③ release-it:bump package.json + commit + tag v0.x.x + CHANGELOG + push + 建 GitHub Release
④ EBUSY 防护:确认 Planrla 应用没跑 + 清理 release/win-unpacked
⑤ 打包:npm run build && npx electron-builder --win nsis zip(读 package.json 版本)
⑥ 上传:gh release upload v0.x.x release/planrla-0.x.x-x64.{exe,zip} --clobber(后台,大文件慢)
⑦ 记录:写 releases/v0.x.x.md + BACKLOG 条目 accepted→released 填版本号
```

**发版记录 `releases/v0.x.x.md` 字段**:版本+日期+主题 / 含哪些 REQ-ID / 验收结论摘要 / 产物链接(GitHub Release URL)/ 已知问题 / **回退方案** / 下版本预告。

**与 RELEASE_CHECKLIST.md 的关系**:License / 签名(CSC_LINK)/ 更新源(NOMAD_UPDATE_URL)等商业预检**保留在原文件**,release-checklist.md 步骤①引用它,不复制。

**与 CHANGELOG.md 的区别**:`CHANGELOG.md` 由 release-it conventional-changelog 插件按 commit 自动生成(commit 维度);`releases/v0.x.x.md` 是人工主题化总结(含验收结论/回退方案,版本维度)。两者互补,不替代。

## 6. 单轨化前置改造(一次性,实施首批任务)

| # | 改动 | 说明 |
|---|------|------|
| 1 | `package.json` `version`:`1.34.0` → `0.2.0` | 对齐当前 tag 线,从此单轨 |
| 2 | `.release-it.json`:删整个 `"npm"` 块 | 不发 npm registry |
| 3 | electron-builder 命令:去掉 `-c.extraMetadata.version=...` | 直接读 package.json,补丁根因消失 |
| 4 | dry-run 验证 | `npx release-it --dry-run` 确认 bump/tag/CHANGELOG 正常,无误发 npm |

改造后 `.release-it.json` 保留:`git.tagName=v${version}` + `github.release` + `conventional-changelog` 插件 + `before:init: npm run build`。

## 7. 风险与约束

- **降版本号(1.34.0→0.2.0)**:上游 merge 时 `version` 字段可能冲突 → 已知,接受;不发 npm 故无 registry 降版问题。
- **EBUSY**:打包前确认 Planrla 应用未运行 + 清理 `release/win-unpacked`(发版工作流记忆已固化)。
- **大文件上传**:exe~250MB + zip~350MB,`gh release upload` 后台跑,5-10 分钟。
- **mac/linux 包**:Windows 上交叉构建不可靠,需对应平台或 CI(本轮仅 Win)。
- **release-it 约束**:`requireCleanWorkingDir:true` + `requireBranch:main` → 发版必须在干净 main。
- **release feed 时效**:发版后需 push 触发 Cloudflare 重建 `latest.json`(见 landing plan)。

## 8. 验收标准(本设计落地完成的标志)

- [ ] `docs/process/` 目录 + README + BACKLOG + templates + releases/ 建齐
- [ ] README 端到端流程图 + 状态机 + 四阶段定义 + 交叉引用现有体系无断链
- [ ] 单轨化改造完成并 `release-it --dry-run` 验证通过
- [ ] BACKLOG.md 含从 roadmap 拆出的初始条目(至少覆盖 P0/P1)
- [ ] templates(acceptance / release-checklist)字段完整、可直接用
- [ ] 选一条 REQ 跑通完整链路作示范(可选,推荐)

## 9. 后续(writing-plans 拆任务)

spec 批准后,由 `writing-plans` skill 拆成实施计划,预计任务分组:
- **Task A**:单轨化前置改造(§6)+ dry-run 验证
- **Task B**:`docs/process/` 骨架 + `README.md`(SOP 主文档)
- **Task C**:`BACKLOG.md` + 从 roadmap 拆初始条目
- **Task D**:`templates/acceptance.md` + `templates/release-checklist.md`
- **Task E**:`releases/` 目录 + 首个发版记录模板(v0.2.0 回填,作示范)

自动化发版 CLI(本轮非目标)作为后续增量,待 SOP 跑顺后再立项。
