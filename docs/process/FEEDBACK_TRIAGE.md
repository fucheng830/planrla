# 用户反馈 → REQ 入池 SOP(Loop 3 接入)

> 目的:把外部反馈信号(Discord / GitHub issue / Hosted 工单 / 数据)系统化编译进 `BACKLOG.md`,堵住「self 单一来源」的 expertware 漏洞。
> 本文件定义 `BACKLOG.md` 的 `来源` 字段取值,是字段规范的 SSOT。
> 配套:`BACKLOG.md`(需求池)、`docs/product/V1_PRODUCT_ROADMAP.md`(战略层,本流程不替代战略)
> 周期:每个 release 周期执行一次(或月度,取先到)

## 为什么需要这个流程

BACKLOG 长期由 `self`(Archie 路线图推演)主导 = 第二层判断在空转,第三层信号没有回流通道。这个流程就是那根神经:让用户原话能穿过判断、落进代码排期。

## `来源` 字段取值规范

| 标签 | 含义 | 例子 |
|------|------|------|
| `self` | Archie 路线图/品味推演(**默认值,但仍必须显式标**,以暴露比例) | REQ-009 工作台 |
| `user:discord` | Discord 社区反馈(附原帖链接或存档到 feedback/) | |
| `user:issue#N` | GitHub issue | `user:issue#42` |
| `user:hosted` | Planrla Hosted 付费客户反馈/工单(**最稀缺信号,优先级最高**) | |
| `user:email` | 邮件 / planrla.com/support 渠道 | |
| `data` | 行为/埋点/日志数据驱动 | |
| `align:<竞品>` | 对齐竞品驱动(**警惕来源,单独可见**) | `align:codex` |
| `churn` | 流失 / 未续费 / 卸载信号 | |

> **两类视角**:`self` / `align:*` = 内向(你的判断);`user:*` / `data` / `churn` = 外向(市场信号)。两类比例就是 loop 2/3 对齐度。

## 执行步骤(每周期一次)

### Step 1 · 采集(≈15min)
- **Discord**:本周期 `#bug` / `#feature` / `#general` 等频道新消息,截链接
- **GitHub issues**:本周期新增 + 有活动的 issue
- **Hosted 工单 / 客户邮件**:付费客户反馈单独标记(`user:hosted`)
- (未来)应用内反馈入口、埋点数据

### Step 2 · 去重归类(≈15min)
- 按主题合并(如「移动端会话接管」归一类)
- 每条标注:**原话**、**提出人数(粗估)**、**紧迫度**

### Step 3 · 评估入池(逐条决策)
对每条反馈四选一,决策必须可追溯:

| 决策 | 动作 |
|------|------|
| **进 backlog** | 自增 REQ-NNN,标 `来源`,走 ready gate(背景+目标+范围+验收标准草稿) |
| **合并现有** | 挂到已有 REQ,在其备注补「用户佐证 + 日期 + 来源标签」 |
| **parked** | 暂搁,**必须写 unpark 条件**(可判定的,不是「等以后」) |
| **dropped** | 不做,写明理由(为何不符合产品方向) |

### Step 4 · 归档原文
- 存 `docs/process/feedback/YYYY-MM.md`(按月归档:原话 + 链接 + 对应 REQ-ID)
- BACKLOG 的 `来源` 字段指回这里的 REQ-ID,形成双向链接

## 体检指标(写进当月归档文件头部)

| 指标 | 健康 | 警戒 |
|------|------|------|
| 新 REQ 中 `user:*` 占比 | > 40% | < 20% → loop 2 在空转 |
| 新反馈与既有 backlog 交集度 | > 50% | < 30% → 在做用户不关心的事 |
| `align:*` 占比趋势 | 持平 / 降 | 上升 → 在复制竞品而非放大长板 |
| `churn` 信号是否全部入池 | 是 | 有流失信号未跟踪 → 漏 |

> **首次执行会很难看**(`self` 占比大概率 > 90%)——这是基线,不是失败。目的是让它随周期下降。

## 首次回溯任务(建立基线)

执行本 SOP 前,先做一次 30 天回溯,产出第一份 `feedback/YYYY-MM.md` + 给 BACKLOG 活跃条目回填 `来源`。这会立刻暴露:
1. `align:codex` 类 REQ 占了多少(P0 危险信号)
2. 哪些高频用户痛点**完全没有对应 REQ**(纯空白区)
3. Hosted 付费客户的反馈有没有被结构化(最稀缺资产是否闲置)

## 相关文件
- `BACKLOG.md` — `来源` 字段(本文件定义其取值)
- `feedback/YYYY-MM.md` — 每月反馈原文归档(执行时创建)
- `README.md` — 发版全生命周期 SOP(需求收集环节引用本文件)
