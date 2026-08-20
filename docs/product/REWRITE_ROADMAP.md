# planrla v2 全量重写路线图(Clean-Room)

> **决策背景**:v1 是 siteboon/claudecodeui(GPL-3.0)的衍生品(上游存量 ≈7.3 万行,你自有 29%)。已走 **GPL bridge**:v1 按 GPL-3.0 公开发发(v0.15.0 已上 R2/官网),同时启动本重写;v2 完成后新版本转回自有许可。
> **制定日期**:2026-08-21。**估时**:12-14 周(solo + AI,参照你 6 周 3 万行的历史速度;待重写量 7.3 万行,但规格文档齐全 + 部分模块可整体保留,实际新写约 5-6 万行)。

---

## 0. Clean-room 纪律(每条都是法律有效性的前提)

1. **不看旧码写新码**:实现时只看 §3 的规格文档(PRD/API_CONTRACT/UX 文档)和运行行为(旧版 UI 点一点、抓包),不打开 v1 源文件"参考"。
2. **可整体搬走的只有 blame 100% 你的文件**(§1 清单),搬运时保留 git 历史可溯源。
3. 新模块的命名、目录划分、架构**故意与 v1 不同**(进一步降低结构性相似)。
4. 每个 v2 模块的提交信息保持可审计("按 API_CONTRACT §x 实现")。
5. v1 仓库保持只读引用(跑行为对照可以,读代码不行——严格讲对照 UI/抓包即可)。

## 1. 直接保留(不在重写范围)

| 资产 | 说明 |
|---|---|
| `planrla-cloud`(整个仓库) | 你的原创(worker/node/agent,billing/usage/waitlist 都在) |
| `landing/`(官网) | 本次会话重写,你的原创 |
| `server/modules/relay-client/` | blame 100%,v2 原样搬 |
| `server/zcode-cli.js`、`server/kimi-cli.js` | 100% 你的 provider 适配器 |
| `electron/`(main/browserview/updater/links) | 100% 你的 |
| `shared/renameCommand.ts`、`src/utils/analytics.ts` | 100% 你的 |
| `server/modules/` 中你 100% 的子模块 | 以 `git blame` 复核为准(cron-prompts、a2a 部分待逐文件核) |
| 全部 `docs/`(规格即蓝图) | PRD/CONTRACT/发版录/REQ |

## 2. 重写分层(依赖序,每层一个里程碑)

| 层 | 范围 | 待新写(约) | 规格来源 | 验收门 |
|---|---|---:|---|---|
| **L1 服务内核** | express 入口、auth/JWT、settings、静态服务、WS 网关(`/ws` 协议) | ~4k 行 | API_CONTRACT.md + 抓包 | API 契约测试全绿;能登录 |
| **L2 Provider 抽象** | Provider Contract 注册表、spawn/会话生命周期、消息归一化 | ~6k 行 | PROVIDER_CONTRACT.md | Claude+Codex+Gemini+Kimi+ZCode 五家跑通一条会话 |
| **L3 会话/项目数据** | projects 发现、sessions 索引/同步(含 FTS5 搜索)、迁移 | ~7k 行 | 功能需求文档 + 行为对照 | 旧版同样的会话列表/搜索结果 |
| **L4 前端壳与聊天** | App 骨架、路由、状态、聊天流(消息渲染/权限卡/流式) | ~20k 行 | UX_INFORMATION_ARCHITECTURE.md | 移动+桌面端主流程 e2e |
| **L5 编辑器/终端/浏览器面板** | CodeMirror、xterm、WebContentsView 集成 | ~8k 行 | 行为对照 | 三面板可用 |
| **L6 生态位功能** | MCP 管理、插件、Git 面板、通知、kanban UI 对接 | ~10k 行 | 各 REQ 文档 | 与 planrla-cloud 联调绿 |

(L4 是最大头;L1-L3 完成后 v2 后端即可与 v1 前端临时对接,提前进入可试用状态——**推荐这个并联点,别等全部完工**。)

## 3. 时间线(锚定 2026-08-25 周一开工)

| 周 | 交付 |
|---|---|
| W1-W2 | L1+L2(内核+五 provider),CI 起 |
| W3-W4 | L3(数据层),v2 后端 ↔ v1 前端临时对接跑通 |
| W5-W8 | L4(前端壳+聊天,最大块) |
| W9-W10 | L5(三面板) |
| W11-W12 | L6(生态位)+ 打包/更新链路复用 |
| W13-W14 | 灰度:beta 用户从 v1 迁移,数据迁移工具,发 v2.0 |

对照跑道:11 月中 v2 RC,12 月正式切自有许可分发——月 9 硬门槛(2027-04)仍有 4 个月余量做营收。

## 4. 风险

- **L4 体量**(20k 行 UI):缓解 = 只实现 UX 文档里的主路径,kanban/团队等入口先做壳。
- **clean-room 纪律疲劳**(想抄一行的冲动):缓解 = 规格先行,每个模块先写验收清单再动手。
- **v1 同时要维护**(beta 反馈/热修):预算每周 ≤1 天,超了就砍 v1 新功能只修 P0。

## 5. 下一步

1. `git blame` 逐文件核出 §1 中 server/modules 的 100% 名单(半小时)。
2. 建 `v2/` 工作区(独立 package.json + tsconfig,共享 node_modules 层面隔离)。
3. W1 开工:L1 按 API_CONTRACT 起服务内核。
