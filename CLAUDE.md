# Planrla 项目指令

> Planrla = 项目级 AI 工作台(桌面 Electron + Web + Android),fork 自 siteboon/claudecodeui。
> 工作目录:`D:\workspace\projects\ai\apps\planrla`

## 发版全生命周期(强制流程)

所有需求与发版工作必须走 `docs/process/` 流程,**不得跳过**。完整 SOP 见 `docs/process/README.md`。

### 硬性规则
1. **需求必入池**:任何需求(口头/bug/想法)先进 `docs/process/BACKLOG.md`,自增 `REQ-NNN`,**不得直接写代码**。
2. **ready gate**:进规格化前,条目须有「背景/目标/范围/验收标准草稿」四要素。
3. **分发走 superpowers**:`ready` → `brainstorming` → `docs/superpowers/specs/` → spec 评审 → `writing-plans` → `docs/superpowers/plans/`。每个 plan frontmatter **必须**写 `REQ-ID: REQ-NNN`。
4. **执行**:`subagent-driven-development`(并行)或 `executing-plans`(带 review checkpoint)。checkbox 全勾 → `review`。
5. **验收三道门**(验收人 Archie):预检(`npm run typecheck && npm run build && git diff --check`)+ 功能(对照 spec 验收标准)+ 回归(抽查)。全过 → `accepted`;任一不过 → 退回 `doing`。
6. **发版单轨**:tag 与 package.json 严格同步(`v0.x.x`),**不发 npm**,**不用 `-c.extraMetadata.version`**(package.json 已对齐 tag,electron-builder 直接读 `${version}`)。按主题发版(feat→minor,fix→patch)。步骤见 `docs/process/templates/release-checklist.md`。
7. **记录**:每次发版写 `docs/process/releases/v0.x.x.md`,BACKLOG 条目置 `released`。

### 状态机
`backlog → ready → spec → plan → doing → review → accepted → released`
异常分支:`blocked` / `dropped`(任意状态可转入)

### PM 行为(我作为需求/发版助手)
- 收到需求 → 录入 BACKLOG + 补 ready 四要素
- 用户说「开始 REQ-NNN」→ 跑 brainstorming → 给 spec 评审 → writing-plans → 派 subagent
- 用户只在评审/决策/验收点介入

## 版本号基线
- **只认 `git ls-remote --tags origin`**(origin 上只有 v0.x.x)。别看本地 tag(上游 v1.x.x 是污染)。
- 当前:package.json `0.2.0` = tag `v0.2.0`(单轨,2026-07-02 起;此前 1.34.0 双轨已废弃)。
- 下一个主题版 → minor(`v0.3.0`);修复 → patch(`v0.2.1`)。

## 关键文档索引
- 战略:`docs/product/V1_PRODUCT_ROADMAP.md`、`PROJECT_WORKBENCH_FUNCTIONAL_REQUIREMENTS.md`
- 流程:`docs/process/README.md`、`BACKLOG.md`、`templates/`、`releases/`
- 商业预检:`docs/commercial/RELEASE_CHECKLIST.md`(License / 签名 / 更新源)
- 架构:`docs/architecture/API_CONTRACT.md`、`PROVIDER_CONTRACT.md`
- 设计依据:`docs/superpowers/specs/2026-07-02-release-lifecycle-design.md`

## worktree 开发约定(强制)

主 worktree(`D:/workspace/projects/ai/apps/planrla`)**只放 `main` 分支**(发版用)。所有需求开发在独立 worktree 进行,避免分支混乱(站错分支 / 多终端干扰)。

- **新需求**:在主 worktree `git worktree add .claude/worktrees/<name> -b feat/<name> main`,在 worktree 内走 spec → plan → 实施 → 验收
- **验收通过**:回主 worktree `git merge --no-ff feat/<name>` 合入 main → `git worktree remove .claude/worktrees/<name>` + `git branch -d feat/<name>`
- **发版**:只在主 worktree(main)跑 `release-checklist`
- **命名**:`.claude/worktrees/req<NNN>-<topic>`(如 `req010-toast-fix`)

## 项目约定(继承 workspace)
- 称呼用户:**Archie**;回复语言:**中文**
- 提交前确认根目录**无 `nul` 文件**
- 删除操作前确认
- 代码同步走 git,禁止服务器直接改源码
- 文件卫生:每文件 ≤ 500 行;新功能每会话 ≤ 300 行;bug 修复每会话 ≤ 50 行
