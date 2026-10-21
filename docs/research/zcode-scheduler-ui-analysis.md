# ZCode 开源版 定时器 + UI 实现分析(2026-10-21)

> 源码:`ZCode/`(zai-org/ZCode v3.16.2,本地已同步 origin/main @ 3c5b2276)。
> 目的:对比 planrla 现有 cron-prompts 实现,列出可移植的调度可靠性与 UI 交互模式。

---

## 一、ZCode 调度架构(三层)

```
UI (packages/ui AutomationEditView/AutomationsSection)
   ↕ RPC
AutomationService (services/src/session/automationService.ts)  ← 语义层
   ↕ SQLite (tasks-index: automations + automation_runs 两表)
Scheduler 独立进程 (packages/desktop/src/scheduler/index.ts)   ← 执行层
   ↕ parentPort
Electron main → host → createTask + sendPrompt(实际 spawn agent)
```

**关键设计:ZCode 不用 cron 库做调度**。croner 只负责「解析表达式 + 算下次时间」;真正的调度是 scheduler 进程 20 秒一轮**轮询数据库认领到期任务**(claimDue:`BEGIN IMMEDIATE` 事务 + running 0→1 原子翻转)。这带来三个能力:

1. **single-flight**:同一任务同一时刻只有一个持有者(数据库行锁语义,不是进程内 Set)
2. **崩溃自愈**:认领超时 10 分钟(CLAIM_STALE_MS)的僵尸 running 行,下一轮 claimDue 自动回收
3. **多实例安全**:即使起两个进程,BEGIN IMMEDIATE 保证不重复派发

### 状态机(比 planrla 细一档)

每条 automation 有三组状态:
- `lifecycle_status`: active / paused / completed(有限次耗尽终态,不可 restart 复活) / failed
- `dispatch_status`: idle / claimed / dispatched / failed_to_dispatch
- 运行历史 `automation_runs`:独立表,每次触发一行(claim → dispatched → 结算),含 modelSelection 快照、error、trigger(schedule/manual)

**派发失败退避**:30s 起步 ×2 指数,封顶 15min,最多 5 次;transient 失败退避重试,permanent 直接失败并跳到下一个正常计划点;退避期间 `retry_at` 优先于 `next_run_at` 参与认领判定。

**misfire 语义**(与 planrla 相反):`next_run_at` 早于 now 超过 5 分钟宽限 → 记 `skipped`(reason: computer_asleep_or_app_not_running),**不补跑**;一次性任务错过即终态。

### 语义层细节(automationCron.ts,值得整文件抄)

- **scheduleRule 权威结构**:cron 字符串只是兼容展示;真实调度用结构化 rule `{unit, interval, hour, minute, weekdays?, monthDays?, monthlyMode?, anchorAt}`(unit: minute|hourly|daily|weekly|monthly|yearly)。解决五段 cron 表达不了「每50小时/每40天/每13个月」的步长上限问题
- **anchorAt 锚点**:所有间隔从真实创建时刻推进——「每30分钟」就是创建后第30分钟,不是每半小时整
- **delayMinutes 相对延迟**:服务端真实时钟生成一次性规则,带秒级 anchorAt,避免 cron 分钟粒度误差
- **one-shot 陈旧目标窗口**:模型把「明天9点」算成已过去的绝对 cron 时,30 分钟窗口内视为模型算错(拒绝并提示用 delayMinutes),<1min 视为跨分钟误差立即执行
- **maxRuns 有限次数**:recurring=false + maxRuns=N;耗尽 → completed 终态;更新时清空 maxRuns 必须同时设 recurring=true
- **任务数上限** 20 条,创建时 BEGIN IMMEDIATE 全量计数防超

## 二、ZCode UI 交互(实测 + 源码)

### 入口模型:「定时任务是任务的一种」

ZCode 不做独立「定时任务面板」——自动化页是**管理面**,但每次触发产生的会话直接出现在**正常会话流**里,带「⏱ 由定时任务发送」标记。任务卡片点进去是**会话本体**(不是编辑页),编辑要回管理面。这个「运行记录融入会话流」的模型和 planrla 的独立面板差异最大,也最值得抄。

### 管理页(AutomationsSection.tsx, 90KB)

- 顶部:「定时任务/闲时任务」双 Tab +「全部/进行中/已完成/失败」状态筛选
- 提示条:「ZCode 运行会话时保持电脑唤醒」+ keep-awake 开关
- 任务卡片网格(两列):标题(自然语言化 cron:「每月8号和13号9点」)、prompt 摘要、状态徽章(⏸已暂停灰/每N分钟绿)、**相对倒计时**「下次运行 9 分钟后」(非绝对时间戳)、「已运行 985 次」计数
- 模板区 2×2:晨会动态/风险扫描/发布简报/文档同步,一键套用
- 立即运行 + 「上一条正在运行中,请稍后再试」防重提示

### 编辑页(AutomationEditView.tsx, 131KB)

- 面包屑:自动化 › 新建任务;「设置/历史」双 Tab(历史=runs 分页表,8条/页)
- 任务标题 +「+ 添加计划」(**一个任务可挂多条调度规则**)
- 频率下拉六项:每小时/每天/每工作日/每周/每月/自定义
- 二级自研轻组件:
  - `TimeOfDayPicker`:pill 触发器 + 弹层双列滚动(HH:MM)
  - `WeekdayPicker`:周圆片多选,禁止清空最后一个
  - `MonthDayPicker`:月+日双列,跨月自动收敛
  - `CustomRepeatSelect`:间隔值(1-200)+单位列,支持「每 3 周」「每 2 个月第一个周五」(monthlyMode: date|weekday)
- cron→中文摘要(automationFormat.ts,19KB):「每小时的第 30 分」「每 3 周的周一、周四 09:00」,覆盖不了回退原文
- 指令区:大文本域 + 工具栏(项目、**变更前确认权限**、模型、推理力度)
- 无取消按钮;提交=右上「创建定时任务」

### 值得抄的交互细节

1. 相对倒计时(「9 分钟后」而非 ISO 时间)
2. 自然语言化 cron 摘要
3. 「已运行 N 次」直接上卡片
4. keep-awake 提示 + 开关
5. 频率六预设 + 自定义单位/间隔/锚点
6. 一任务多调度规则
7. 运行记录融入会话流 + trigger 标记
8. 模板冷启动
9. 状态筛选四档
10. 派发失败时卡片显示 retry 排队信息

## 三、planrla 现状 vs 差距

| 能力 | ZCode | planrla 现状 | 差距 |
|---|---|---|---|
| 调度方式 | DB 轮询认领(20s)+事务锁 | 进程内 node-cron | 大:崩溃丢调度、无双实例保护 |
| misfire | 5min 宽限记 skipped 不补 | 7天窗口补跑一次 | 语义分歧:可并存为 per-task 策略 |
| 派发失败 | 退避30s→15min×5+transient/permanent | 无重试,失败即结束 | 高价值 |
| 运行历史 | automation_runs 独立表 | 仅 last_run_at/last_session_id/run_count | 高价值 |
| single-flight | DB 原子认领 | 进程内 Set | 单实例够用,重启即丢 |
| 调度语义 | 结构化 scheduleRule+anchorAt | 纯 cron 字符串 | 中:「每50小时」表达不了 |
| 一次性任务 | delayMinutes+one-shot 终态 | 无 | 抄 |
| 有限次数 | recurring+maxRuns+completed | 无 | 抄 |
| UI | 会话流融合、六频率、倒计时、模板 | 独立面板、模式radio | 大 |

## 四、移植建议(按 ROI 排序)

1. **P0 派发失败退避** — 抄 dispatch_attempts/retry_at/failure_kind 三列 + driver 退避循环
2. **P0 run 历史表** — 新建 cron_prompt_runs;recordRun 升级为逐次插入;UI 加历史 Tab
3. **P1 相对倒计时+中文摘要** — 纯前端,automationFormat 模式
4. **P1 一次性任务+maxRuns** — delayMinutes 创建路径 + 有限次数终态
5. **P2 scheduleRule 结构化** — 加 schedule_rule JSON 列存权威,cron 留兼容
6. **P2 DB 认领式调度** — node-cron → 20s 轮询+BEGIN IMMEDIATE(补 running/claimed_at 列)
7. **P2 UI 会话流融合** — 会话加 trigger 徽章;模板区;状态筛选;keep-awake

## 五、文件地图

```
ZCode/packages/services/src/session/
  automationCron.ts            # 语义核心
  automationCronValidation.ts
  automationService.ts         # 生命周期
  automationRepo.ts            # SQLite+claimDue+退避+上限
  automationIntervalCarrier.ts
ZCode/packages/desktop/src/scheduler/
  index.ts                     # 调度进程(436行)
  schedulerProtocol.ts
ZCode/packages/ui/src/settings/
  AutomationEditView.tsx       # 编辑页(131KB)
  AutomationsSection.tsx       # 管理页(90KB)
  automationFormat.ts          # cron→中文摘要(19KB)
  automationTemplateCatalog.ts
```
