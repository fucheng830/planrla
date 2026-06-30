# Planrla 商业化中继服务 — 设计与 MVP 计划

## 1. 背景与决策

- **目标**：把 apps/android 商业化。手机在任何网络下，经云端中继 `api.planrla.com` 控制用户**家里的** Claude（Planrla server）。
- **模式 A（已定）**：中继 SaaS。claude 会话/凭据/数据都留在用户家；云端只做过境转发 + 鉴权 + 计费。合规与责任边界对运营商最有利。
- **基础设施（已定）**：`api.planrla.com` 托管在 Cloudflare → 用 **Workers + Durable Objects** 做边缘接入和有状态 WS 中继（CF 原生能力，无服务器）。
- **MVP（已定）**：先单用户（你自家 server + App）经 `api.planrla.com` 全打通，验证延迟/稳定性/真实 CF 成本，再做多租户和计费。

**非目标（MVP 之后）**：多租户账号体系、计费、E2EE、多 device。

---

## 2. 架构总览

```
App ──HTTPS/WSS──▶ api.planrla.com ──▶ 用户家
                   Worker(边缘)：验 token、按 userId 路由到 RelayDO
                   RelayDO(每用户一个)：持有家端 agent 的常驻 WS，把入站 HTTP/WS 转发过去
                                        ──▶ 家端 relay agent ──▶ 本机 Planrla(localhost:3002) ──▶ claude
```

### 关键设计：App 改造最小化

App **不改 transport**，只换 URL：
- REST：`baseURL = https://api.planrla.com`（Retrofit 照常发 HTTP）。
- WS（chat/shell）：`wss://api.planrla.com/ws`、`wss://api.planrla.com/shell`。
- 鉴权：URL query 或 header 带 `device token`。

复杂度都在云端和家端：**Worker 把入站 HTTP/WS 转成多路复用(mux)消息，经 RelayDO 送到家端 agent，agent 还原成本地 HTTP/WS 调本地 Planrla。**

---

## 3. 中继协议（mux over WS）

家端 agent 与 RelayDO 之间是一条常驻 WS，上面多路复用多条逻辑流（每个 HTTP 请求 / 每个 chat/shell WS 一条 `streamId`）。消息（JSON，二进制帧用于大 body）：

| kind | 方向 | 字段 | 含义 |
|---|---|---|---|
| `http_req` | 云→家 | `streamId, method, path, headers, body?` | 发起一次本地 HTTP 请求 |
| `http_res` | 家→云 | `streamId, status, headers, body?` | HTTP 响应 |
| `ws_open` | 云→家 | `streamId, path, headers` | 在本地开一条 WS（chat/shell） |
| `ws_data` | 双向 | `streamId, data(string\|binary)` | WS 帧透传 |
| `ws_close` | 双向 | `streamId, code?` | 关闭该 WS |
| `ping`/`pong` | 双向 | — | 心跳，保活 + 断线检测 |

- `streamId` 单调递增，流关闭即回收。
- 大 body（文件上传/下载、流式输出）走二进制帧 + 分片。

---

## 4. 组件设计

### 4.1 云端 Worker（边缘入口）
- 路由：
  - `/:path*`（HTTP）和 `/ws`、`/shell`（WS 升级）：从 token 解出 `userId` → `env.RELAY_NAMESPACE.get(idFromName(userId))` 拿 RelayDO → `relayDO.fetch(request)` 或把 WS 桥接进 DO。
  - `/relay`（WS）：家端 agent 的入站连接（带 device token）→ 同样进该用户的 RelayDO，注册为「家端通道」。
  - `_admin/*`：注册/登录/订阅（MVP 后）。
- 鉴权：MVP 用单个 `device token`（D1/KV 存 userId↔token）。后续换 JWT + 用户体系。
- 限流/用量：Worker 入口记字节/请求（D1），供计费。

### 4.2 RelayDO（Durable Object，每用户一个）
- 状态：当前家端 agent 的 WS（0 或 1 条）+ 多条 App 流的 streamId 映射。
- `fetch(request)`：把入站 HTTP 封装成 `http_req` 发到家端 WS，await 对应 `http_res`，还原成 `Response` 返回 Worker（→ App）。
- WS 桥接：App 的 `/ws`、`/shell` 连接进 DO 后，开一个 streamId，`ws_open` 到家端；后续 `ws_data` 双向转发。
- 家端未连接时：返回 503（App 提示「设备离线」）。
- 并发：多个 App 流并行，各自 streamId 互不阻塞。

### 4.3 家端 relay agent（新，单文件 .exe）
- 技术栈：Python（沿用 m5 的 PyInstaller 打包）或 Go 单文件（更省心，无运行时）。MVP 先 Python 快速验证。
- 职责：
  - 出站连 `wss://api.planrla.com/relay?token=<device>`，自动重连 + 心跳。
  - 收 `http_req` → 对 `localhost:3002` 发真实 HTTP → 回 `http_res`。
  - 收 `ws_open` → 连 `ws://localhost:3002< path>` → 双向 `ws_data`。
- 配置：device token + 本地 Planrla 端口。nssm/启动项自启（沿用 Planrla 的部署模式）。
- 打包：`relay.exe`（+ 可选和 Planrla 一起的 installer）。

### 4.4 App 改造（apps/android）
- `Net.kt`：`baseURL` 改 `https://api.planrla.com`；`ChatSocket` WS 改 `wss://api.planrla.com/ws?token=...`；Shell 的 `/shell` 同理。
- 鉴权：登录后存 `device token`（DataStore），所有请求带 token。
- 保留「直连 / 中继」开关（调试和本地场景友好）。
- 设备离线提示（503 时）。

---

## 5. MVP 范围与任务（单用户打通）

> 目标：你自家的 Planrla（0.13 或本机）+ 你的 App，经 `api.planrla.com` 跑通：REST（项目/消息/git/文件）+ chat WS（流式）+ Shell WS（终端）。验证端到端 + 测 CF 真实成本。

| # | 任务 | 产出 | 验证 |
|---|---|---|---|
| **T1** | CF 项目脚手架 | `relay/`（wrangler）+ Worker + 空 RelayDO，`wrangler dev` 本地起 | `curl` 命中 Worker，DO 能实例化 |
| **T2** | mux 协议 + DO 转发 | DO 实现 `fetch`(HTTP→`http_req`→`http_res`) + WS 桥接；家端协议对齐 | 本地两台进程（假家端 + 假 App）经 DO 互发 HTTP/WS 通过 |
| **T3** | 家端 relay agent | `relay-agent/`（Python）出站 WS + 本地 HTTP/WS 代理 + 重连心跳 | agent 连本地 DO，把 HTTP 请求落到 `localhost:3002`，响应回传 |
| **T4** | 端到端本地联调 | 真 Planrla + agent + DO + App(改 baseURL) | App 经本地 wrangler 看到 0.13 的项目列表/聊天/Shell |
| **T5** | 部署到 api.planrla.com | `wrangler deploy` + DNS/路由 + device token | 手机 4G 下 App 连 `api.planrla.com` 操作家里的 claude |
| **T6** | 成本与稳定性实测 | 一周真实使用，记录 CF 账单（DO duration / WS 消息 / 流量） | 拿到单用户月成本 → 推多用户定价 |

依赖：T1→T2→T3→T4→T5→T6（基本线性，T3 可与 T2 后半并行）。

---

## 6. 路线（MVP 之后）

1. **多租户（~3 周）**：注册/登录/OAuth → JWT；device 注册与配对；一用户多 device；App 账号体系。
2. **商业化（~2 周）**：Stripe 订阅、用量统计（D1）、落地页、onboarding（家端 agent 双击安装）。
3. **加固**：限流/滥用防护、E2EE（App↔家端协商密钥，云端只见密文）、监控告警、SLA、家端 agent 自动更新。

---

## 7. CF 成本与风险

- **计费点**：Workers 请求、Durable Objects duration（家端常驻 WS 一直计费）、WS 消息数、流量。claude 流式输出 = 持续小消息，DO 消息费要重点算。
- **缓解**：T6 先测真实账单；重度流式可考虑 App↔家端在某些场景直连（打洞 fallback）以省中继流量；定价留 buffer。
- **家端部署门槛**：必须「双击运行」（installer + 自启）。
- **可用性**：依赖 CF；家端 agent 断线要有 App 侧「设备离线」提示 + 自动重连。
- **Shell 终端**：已是 WS 二进制帧，DO 透传即可，无额外工作。

## 8. 待决（不影响 MVP 启动）

- 家端 agent 语言：Python（快）vs Go（省运行时、单文件）。建议 MVP 用 Python，验证后视打包体验决定是否转 Go。
- 多 device 路由策略：MVP 单 device，后续一个 userId 下多 device 时 App 选设备。
- E2EE 是否进 MVP：建议不进（MVP 聚焦打通），商业化阶段加。

---

## 下一步

从 **T1（CF 项目脚手架 + Worker/DO 骨架，wrangler dev 跑通）** 开始。需要我开 T1 吗？开之前确认：CF 账号你已有、`wrangler` 可在本机装（`npm i -g wrangler`）。
