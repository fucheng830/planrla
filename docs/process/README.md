# Planrla 发版全生命周期 SOP

> 这是「需求 → 分发 → 验收 → 发版」的标准流程,所有需求与发版工作必须遵循。
> 设计依据:`docs/superpowers/specs/2026-07-02-release-lifecycle-design.md`
> 战略层:`docs/product/V1_PRODUCT_ROADMAP.md`(本流程不替代战略,只管执行)

## 端到端流程

```
BACKLOG.md(需求池,SSOT)
  ① 规格化  ready → brainstorming → spec(docs/superpowers/specs/)
  ② 拆任务  spec 评审 → writing-plans → plan(docs/superpowers/plans/),frontmatter 写 REQ-ID
  ③ 执行    subagent-driven-development / executing-plans → checkbox 全勾
  ④ 验收    三道门(预检+功能+回归)→ accepted
  ⑤ 收敛    攒主题 → 发版就绪检查
  ⑥ 发版    release-checklist → tag v0.x.x + electron-builder + 上传 Release
  ⑦ 记录    releases/v0.x.x.md + BACKLOG → released
```

## BACKLOG 状态机

```
backlog → ready → spec → plan → doing → review → accepted → released
异常分支:blocked / dropped(任意状态可转入)
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

## 阶段细则

### ① 需求收集(BACKLOG.md)
- 任何来源(口头/bug/想法/roadmap 拆解)→ PM 整理成条目,自增 REQ-NNN
- **ready gate 四要素**:背景 + 目标 + 范围 + 验收标准草稿,缺一不进 brainstorming
- roadmap 仅作分类锚(M1-M6 / P0-P1-P2),不细动

### ② 分发任务(复用 superpowers + worktree 隔离)
- **在独立 worktree 开发**(强制,见 `CLAUDE.md`「worktree 开发约定」):`git worktree add .claude/worktrees/req<NNN>-<topic> -b feat/req<NNN>-<topic> main`,主 worktree 只留 main
- 在 worktree 内走完 spec → plan → subagent 执行 → 验收

| 步骤 | 产物 | 状态流转 |
|------|------|---------|
| 规格化 | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | ready→spec |
| 拆任务 | `docs/superpowers/plans/YYYY-MM-DD-<topic>-impl.md` | spec→plan |
| 执行 | plan checkbox 全勾 | plan→doing→review |

plan frontmatter 必须写 `REQ-ID: REQ-NNN`,与 BACKLOG 双向链接。

### ③ 验收(三道门,验收人 Archie)
- **预检门**:`npm run typecheck && npm run build && git diff --check` 全过
- **功能门**:plan 末尾验收清单逐项勾(对照 spec 验收标准)
- **回归门**:抽查改动影响的既有功能
- 全过 → accepted;任一不过 → 退回 doing(列出问题)

### ④ 发版(单轨,主题化)
- 攒一组 accepted 条目(一个主题)→ 发版
- **版本号**:feat 主题 → minor(v0.2.0→v0.3.0);fix/chore → patch(v0.2.1)
- **单轨**:tag 与 package.json 严格同步,不发 npm,不用 `-c.extraMetadata.version`
- 步骤:`templates/release-checklist.md`
- 记录:`releases/v0.x.x.md`(人工主题化);`CHANGELOG.md` 由 release-it 自动生成(commit 维度)

## 文件清单
- `BACKLOG.md` — 需求池 SSOT
- `templates/acceptance.md` — 验收清单模板(plan 末尾嵌入)
- `templates/release-checklist.md` — 发版清单(单轨 7 步)
- `releases/v0.x.x.md` — 每版本发版记录
