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

## UI 层问题分流(强制:A2A → Kimi)

**所有 UI 层相关的问题**——Android Compose UI(`apps/android/.../ui/`)、前端 web UI(`src/components/`、`src/`)的样式 / 布局 / 交互 / 组件 / 主题配色 / 间距——**不自己改代码**,统一通过 A2A 委托 **Kimi** 处理:

- 先 `a2a_list_sessions`(`url=http://127.0.0.1:3001/api/a2a`)看有没有现成可复用的 kimi 会话;没有就 spawn。
- 调用:`a2a_call(url="http://127.0.0.1:3001/api/a2a", provider="kimi", spawn=true, projectPath=<相关项目路径>, message=<UI 问题描述 + 验收标准>)`,或带现有 kimi `sessionId` 委托已有会话。
- 我(hub / 中心)只负责:把 UI 问题拆清楚派给 Kimi、收回结果、做集成 / 验收 / 发版,**不直接动 UI 代码**。
- 非 UI 层(后端 / infra / 数据库 / 发版流程 / A2A 本身)照常自己处理,不走这条。

> 设计意图:UI 细节多、迭代频,交给专注 UI 的 Kimi agent 并行处理,hub 聚焦架构与发版。

## 项目约定(继承 workspace)
- 称呼用户:**Archie**;回复语言:**中文**
- 提交前确认根目录**无 `nul` 文件**
- 删除操作前确认
- 代码同步走 git,禁止服务器直接改源码
- 文件卫生:每文件 ≤ 500 行;新功能每会话 ≤ 300 行;bug 修复每会话 ≤ 50 行

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
