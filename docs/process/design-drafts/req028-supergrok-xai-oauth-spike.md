# REQ-028 Spike:Grok Build CLI 集成可行性研究

> **需求**:把 Grok 能力集成进 Planrla。
> **来源**:Archie 见 [yetone 帖子](https://x.com/yetone/status/2075259209676144680)(Alma 支持 SuperGrok 插件)。来源 `self`,参考 `align:alma`。
> **日期**:2026-07-10 · **状态**:spike v2(方向修正)完成,待 brainstorming
> **正确路径**:**Grok Build CLI 作为第 6 个 CLI agent provider 接入**(非 http LLM provider)

---

## ⚠️ 方向修正(v2)

v1 误把 Grok 当纯 LLM API,建议「新增 http provider」。**Archie 指出 Grok 有自己的官方 coding agent CLI(Grok Build CLI)**——它和 Claude Code / Codex CLI / Gemini CLI 同类,有 session / mcp / subagents。故正确路径是 **CLI agent provider**,与 Planrla 现有 `codex/claude/gemini/opencode/cursor` 完全同构。http provider 路径降级为备选(见 §8)。

## TL;DR

1. **Grok Build CLI** 是 xAI 官方 coding agent CLI(beta),对标 Claude Code,有完整 agentic 能力(session/mcp/subagents/plan mode)。
2. **有机器可读输出**(streaming-json + session resume + ACP),满足 Planrla 接入充要条件。
3. **接入 = 新增 `server/grok-cli.js` + `list/grok/` provider**,复刻 opencode 模式(spawn + streaming-json),模式成熟,难度中。
4. **OAuth 登录走 SuperGrok 订阅**(官方,干净);tier 403 风险仍在。
5. 建议:入池 → brainstorming(议题含实测 grok streaming-json schema + session 机制 + OAuth UX)。

## 1. Grok Build CLI 是什么

- xAI 官方 coding agent CLI(early beta),对标 Claude Code / Codex / Gemini CLI
- 安装:`curl -fsSL https://x.ai/cli/install.sh | bash` 或 `npm i -g @xai-official/grok`
- 能力:TUI + headless、**session management**、**MCP**、**subagents**、plan mode、git worktree
- 登录:xAI OAuth(SuperGrok 订阅,同官方流程)或 `XAI_API_KEY`
- 文档:`docs.x.ai/build/`

## 2. 机器可读协议(接入充要条件 ✅)

| 能力 | flag / 机制 |
|----|----|
| headless 非交互 | `grok -p "prompt"` |
| streaming JSON | `--output-format streaming-json`(newline-delimited) |
| JSON 批量 | `--output-format json` |
| **session resume** | `grok --session latest`(有 session 概念) |
| ACP | JSON-RPC over stdin/stdout(`docs.x.ai/build/cli/headless-scripting`) |

参考:codex 用 SDK 事件(`item.started/updated/completed`),claude 用 `--output-format stream-json`,grok 的 `streaming-json` 同类。

## 2.5 实测确认(2026-07-10 本机,Windows)

已在本机安装实测(`npm i -g @xai-official/grok`,官方维护者 `xai-security@x.ai`,版本 `0.2.93`):

| 项 | 实测结果 |
|----|----|
| 安装 | `npm i -g @xai-official/grok`(或 `curl x.ai/cli/install.sh \| bash`)。**Windows 坑**:Git Bash 直接调 `grok` 触发 MSYS 路径 bug(`D:\anaconda3\Library\c\Users\...` 拼接错),须用 `grok.cmd` / `cmd //c grok` |
| 认证文件 | `~/.grok/auth.json`(Planrla 可读复用,同其他 CLI) |
| 登录 | `grok login --oauth`(走 auth.x.ai)或 **`grok login --device-auth`**(device-code,headless/远程友好,**Planrla/Electron 首选**,无需 localhost 回调) |
| headless | `-p/--single` + `--output-format streaming-json` 确认存在;另有 `grok agent` 子命令 = 无 TUI 的 agent 入口 |
| session | `-r/--resume`、`-c/--continue`、`-s/--session-id`、`--fork-session`;`grok sessions` 子命令列/搜/恢复 |
| **接口对齐 Claude Code** | `--permission-mode [default\|acceptEdits\|auto\|dontAsk\|bypassPermissions\|plan]` 枚举值与 Planrla 现有抽象**完全一致**;`--allow/--deny`、`--system-prompt-override`、`--worktree`、subagents、plan mode 齐全(help 里直接标注 "Claude Code: --allowedTools" 对应关系) |
| 子命令 | `models`/`sessions`/`mcp`/`memory`/`login`/`logout`/`export`/`import`/`inspect`/`plugin`/`leader`/`update` 等,基本覆盖 Planrla provider 各能力面 |

**关键判断**:grok CLI 是目前与 Claude Code 接口最一致的 coding agent(连 permission mode 枚举值都一样)→ **grok provider 可大量复用 claude provider 逻辑**(permission 映射、session resume、streaming-json 解析),接入成本比预估更低。

**第二阶段实测结果(2026-07-10,SuperGrok 订阅登录后)**:

登录成功(`grok login --oauth` 在 PowerShell 跑,认证为 grok.com 订阅,`~/.grok/auth.json` 已生成)。**tier 403 未出现**——models 列表 + 实际调用都通。

streaming-json 事件 schema(newline-delimited,每行一个 JSON,**极简**):
```
{"type":"thought","data":"..."}   # reasoning 增量(逐 token)
{"type":"text","data":"..."}      # 回复增量(逐 token)
{"type":"end","stopReason":"EndTurn","sessionId":"<uuid>","requestId":"<uuid>"}  # 结束
```
- **仅 3 种事件类型**(thought/text/end),结构 `{"type","data"}` —— 比 codex SDK 事件(`item.started/updated/completed`)简单得多,解析器很轻
- `end` 事件带 `sessionId` + `stopReason`(**Planrla 直接复用 sessionId**)
- ⚠️ streaming/json 输出**未含 token usage 字段**(usage 提取需另寻途径:grok sqlite / `--debug-file` / 或暂不支持 usage 显示)

`--output-format json`(非流式最终结果,Planrla 拿最终态用):
```json
{"text":"...","stopReason":"EndTurn","sessionId":"...","requestId":"...","thought":"..."}
```

`grok models`(已认证,Planrla models provider 直接解析):
```
You are logged in with grok.com.
Default model: grok-4.5
Available models:
  * grok-4.5 (default)
  - grok-composer-2.5-fast
```

`grok sessions` 子命令:`list` / `search` / `delete`(`grok sessions list` 列最近 session)。

**意外利好**:grok-4.5 在项目 cwd 跑时**自动读取并遵守 `CLAUDE.md`**(实测 thought 里它按项目约定用中文回复、称呼 Archie)→ Planrla 接入后 grok 天然遵守项目规则文件,行为与 claude/codex 一致。

**待 spec/实施时补抓(非阻塞)**:工具调用事件 schema(需触发 tool 的 coding prompt)、token usage 来源。

## 3. Planrla 接入模式(成熟,可复刻)

现有 5 个 CLI 封装:`openai-codex.js`(SDK)/ `claude-sdk.js` / `gemini-cli.js` / `cursor-cli.js` / `opencode-cli.js`(**spawn 模式**)。

grok 无官方 Node SDK → 走 **opencode 模式**(spawn `grok` + 解析 streaming-json):
- **共用基础设施**:`sessionsService` / `providerAuthService` / `providerModelsService` / `createNormalizedMessage` / `notifyRunFailed` / active-process Map
- **新增 `server/grok-cli.js`**:spawn 进程 → 解析 streaming-json 事件 → 映射统一 WebSocket 消息 → 提取 token usage → abort
- **新增 `server/modules/providers/list/grok/`**:provider 组装,仿 codex 目录

provider 骨架(对照 `codex.provider.ts`):
```
server/modules/providers/list/grok/
  grok.provider.ts                 # extends AbstractProvider('grok')
  grok-auth.provider.ts            # OAuth(SuperGrok)+ API key 降级
  grok-models.provider.ts          # grok-build-0.1 / grok-code-fast-1 / grok-4.x
  grok-sessions.provider.ts        # 复用 grok --session
  grok-mcp.provider.ts             # grok 的 MCP 支持
  grok-skills.provider.ts          # AGENTS.md / skills
  grok-session-synchronizer.provider.ts
```

**capabilities 全 true**(sessions/tools/mcp 都有)——和 codex 同构,**不是 http 异类 provider**。`PROVIDER_CONTRACT` 现有抽象无需改造。

## 4. 合法性

官方 OAuth(`accounts.x.ai`)+ 官方 CLI(`x.ai/cli`)+ 官方 endpoint(`api.x.ai`)。xAI 主动开放给第三方(新闻 [Use Grok in OpenClaw](https://x.ai/news/grok-openclaw))。干净,合规风险低。唯一运营风险:依赖 xAI shared OAuth client(若收紧会受影响)。

## 5. 风险清单

| 风险 | 说明 | 缓解 |
|------|------|------|
| **tier 403** ⚠️ | 标准 SuperGrok 订阅也可能被 OAuth API 拒(issue #26847) | `grok` 登录失败 → 提示 `XAI_API_KEY` 降级 |
| **streaming-json schema 未知** | 事件字段需实测 | spec 前小 spike:跑 `grok -p "hi" --output-format streaming-json` 抓事件格式 |
| grok CLI 依赖 | 用户需自装 grok CLI | 仿现有 CLI 检测(参考 taskmaster/opencode 检测逻辑) |
| session 存储机制 | grok session 存哪、怎么 resume 需确认 | 实测 + 对齐 sessions provider |
| Electron OAuth UX | `grok login` 在桌面/headless 的行为 | device-code 优先(无回调,Electron 友好) |

## 6. 可行性结论

| 维度 | 判断 |
|------|------|
| 合法性 | ✅ 官方 OAuth + 官方 CLI,干净 |
| 技术可行 | ✅ streaming-json + session + ACP 齐备;opencode spawn 模式可复刻 |
| 工作量 | 中(一个 CLI 封装 + provider 组装,模式成熟) |
| 价值 | 高(Planrla 第 6 个 coding agent;Grok 的 web/X search 是差异化能力;走订阅零 API 费) |
| 主要不确定 | grok streaming-json 事件 schema(需实测)、tier 403 命中率 |

**总判断:值得做,且比 v1 的 http provider 路径更正统(同构,非异类)。**

## 7. 下一步

1. **入池 REQ-028(backlog)** ✅ 已入
2. **brainstorming**,核心议题:
   - 实测 grok streaming-json 事件 schema(建议 spec 前小 spike)
   - session 模型对接(grok session ↔ Planrla session)
   - OAuth UX(device-code vs 直接调 `grok login`)
   - 能力范围(只 chat,还是含 web_search / x_search / image 等差异化能力)
3. spec → plan → 实施(独立 worktree `req028-grok-cli`)

## 8. 备选路径(降级,仅当不依赖 CLI 时)

**路径 B:http LLM provider**。用 `api.x.ai/v1` Responses API + OAuth,新增 `runtime='http'` provider。缺点:无 session/skills/mcp,是 Planrla **第一个非 CLI 异类 provider**,需改造 UI 运行层假设。仅当 grok CLI 不可用或明确不希望依赖 CLI 时考虑。

## 9. 参考来源

- Grok Build 官方:[overview](https://docs.x.ai/build/overview) · [发布](https://x.ai/news/grok-build-cli) · [headless](https://docs.x.ai/build/cli/headless-scripting) · [changelog](https://x.ai/build/changelog)
- 集成参考:[Hermes 委派 Grok Build](https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-grok)
- OAuth 机制:[OpenClaw xAI](https://docs.openclaw.ai/providers/xai) · [Hermes xAI OAuth](https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth)
- 原帖:[yetone](https://x.com/yetone/status/2075259209676144680) · [Alma](https://alma.now/)
