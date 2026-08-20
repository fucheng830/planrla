<div align="center">
  <img src="public/logo.svg" alt="Planrla" width="64" height="64">
  <h1>Planrla</h1>
  <p>A desktop and mobile UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a>, <a href="https://geminicli.com/">Gemini-CLI</a>, <a href="https://opencode.ai">OpenCode</a>, <a href="https://moonshotai.github.io/kimi-code/">Kimi Code</a>, and <a href="https://z.ai">ZCode (GLM)</a>.<br>Agents run long tasks on your machine — Planrla pushes an alert to your phone when they need you, and you approve from anywhere.</p>
</div>

<p align="center">
  <a href="https://planrla.com">Website</a> · <a href="https://planrla.com#waitlist">Contact</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<div align="right"><i><b>English</b> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---

## Screenshots

<div align="center">
  
<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Select between Claude Code, Gemini, Cursor CLI, Codex, OpenCode and Kimi Code</em>
</td>
</tr>
</table>



</div>

## Features

- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile so you can also use Agents from mobile 
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with the Agents
- **Integrated Shell Terminal** - Direct access to the Agents CLI through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Git Explorer** - View, stage and commit your changes. You can also switch branches 
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **Plugin System** - Extend Planrla with custom plugins — add new tabs, backend services, and integrations
- **TaskMaster AI Integration** *(Optional)* - Advanced project management with AI-powered task planning, PRD parsing, and workflow automation
- **Model Compatibility** - Works with Claude, GPT, Gemini, Kimi, and GLM model families (the full list of supported models is available at runtime via `GET /api/providers/:provider/models`)


## Quick Start

### Desktop (Recommended)

Download the Windows installer from [planrla.com](https://planrla.com) (macOS/Linux builds coming), or build from source with `npm run desktop:dist`. The desktop app bundles the server and updates itself from `updates.planrla.com`.

### Remote Access (Beta — free during beta)

Sign in to your Planrla account in Settings → Remote Access, register this desktop, and open the copied device link in any phone browser to view sessions, approve permission requests, and receive push notifications when a task finishes or needs you. All traffic is an **outbound** relay from your machine to `api.planrla.com` — no public IP, port forwarding, or VPN. Pro ($9/mo, coming) raises quotas; Team ($19/seat/mo, coming) adds shared boards and multi-machine agent coordination.

### Self-Hosted

#### npm

Try Planrla instantly with **npx** (requires **Node.js** v22+):

```
npx planrla
```

Or install **globally** for regular use:

```
npm install -g planrla
Planrla
```

Open `http://localhost:3001` — all your existing sessions are discovered automatically.

Configuration is environment-driven (`SERVER_PORT`, `HOST`, `JWT_SECRET`, …) and persists to a local SQLite database.

#### Docker Sandboxes (Experimental)

Run agents in isolated sandboxes with hypervisor-level isolation. Starts Claude Code by default. Requires the [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/).

```
npx planrla@latest sandbox ~/my-project
```

Supports Claude Code, Codex, and Gemini CLI. See the [sandbox docs](docker/) for setup and advanced options.


---

## Which option is right for you?

Planrla runs on your machine; Remote Access relays it to your phone over an outbound connection. Docker sandboxes are for isolated agent execution.

| | Desktop | Self-Hosted (npm) | Remote Access (Beta) |
|---|---|---|---|
| **Best for** | Daily driver, native experience | Running beside your existing setup | Controlling agents from your phone, anywhere |
| **How you access it** | Native window | Browser via `[yourip]:port` | Any browser via `api.planrla.com` device link |
| **Setup** | Installer from [planrla.com](https://planrla.com) | `npx planrla` | Sign in + register device in Settings |
| **Machine needs to stay on** | Yes | Yes | Yes (agents run on your machine) |
| **Push notifications** | Desktop notifications | Desktop notifications | Phone push: permission needed / task done |
| **Agents supported** | Claude Code, Cursor CLI, Codex, Gemini CLI, OpenCode, Kimi Code, ZCode | Same | Same |
| **Team sharing** | Team sync via planrla-cloud | Team sync via planrla-cloud | Team sync via planrla-cloud |
| **Cost** | Free (beta) | Free | Free during beta; Pro $9/mo coming |

> All options use your own AI subscriptions (Claude, Cursor, Kimi, GLM, etc.) — Planrla provides the workbench, not the AI.

---

## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Enable Selectively** - Turn on only the tools you need
3. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

---

## Plugins

Planrla has a plugin system that lets you add custom tabs with their own frontend UI and optional Node.js backend. Install plugins from git repos directly in **Settings > Plugins**, or build your own — a plugin is a manifest plus a frontend bundle, with RPC communication to an optional backend process.

---
## FAQ

<details>
<summary>How is this different from Claude Code Remote Control?</summary>

Claude Code Remote Control lets you send messages to a session already running in your local terminal. Your machine has to stay on, your terminal has to stay open, and sessions time out after roughly 10 minutes without a network connection.

Planrla extends Claude Code rather than sitting alongside it — your MCP servers, permissions, settings, and sessions are the exact same ones Claude Code uses natively. Nothing is duplicated or managed separately.

- **All your sessions, not just one** — Planrla auto-discovers every session from your `~/.claude` folder.
- **Your settings are your settings** — MCP servers, tool permissions, and project config you change in Planrla are written directly to your Claude Code config and take effect immediately, and vice versa.
- **Works with more agents** — Claude Code, Cursor CLI, Codex, Gemini CLI, OpenCode, Kimi Code, and ZCode, not just Claude Code.
- **Full UI, not just a chat window** — file explorer, Git integration, MCP management, and a shell terminal are all built in.
- **Remote Access keeps you in command** — agents keep running on your machine while you approve, intercept, or take over from your phone.

</details>

<details>
<summary>Do I need to pay for an AI subscription separately?</summary>

Yes. Planrla provides the workbench, not the AI. You bring your own Claude, Cursor, Codex, Gemini, Kimi, or GLM subscription. Remote Access is free during beta; a Pro plan ($9/mo) is coming.

</details>

<details>
<summary>Can I use Planrla on my phone?</summary>

Yes. On your network, open `[yourip]:port` in any browser. From anywhere, enable Remote Access (Settings → Remote Access) and open your device link in a phone browser — you get the full UI plus push notifications when an agent needs your approval or finishes a task. An Android app is also available.

</details>

<details>
<summary>Will changes I make in the UI affect my local Claude Code setup?</summary>

Yes. Planrla reads from and writes to the same `~/.claude` config that Claude Code uses natively. MCP servers you add via the UI show up in Claude Code immediately and vice versa.

</details>

---

## Community & Support

- **[Website](https://planrla.com)** — overview, pricing, and beta sign-up
- **[Website / Beta sign-up](https://planrla.com#waitlist)** — bug reports and feature requests
- **[Contributing Guide](CONTRIBUTING.md)** — how to contribute to the project

## License

Planrla is licensed under the **GNU GPL v3** — see [LICENSE](LICENSE).

It is a derivative work of [CloudCLI (claudecodeui)](https://github.com/siteboon/claudecodeui) by Simos Mikelatos / siteboon. Community contributions are welcomed under GPL-3.0.

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[OpenCode](https://opencode.ai)** - Open source coding agent CLI
- **[Kimi Code](https://moonshotai.github.io/kimi-code/)** - Moonshot AI's official CLI
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - AI-powered project management and task planning


### Sponsors
- [Planrla](https://planrla.com)
---

<div align="center">
  <strong>Made with care for the Claude Code, Cursor and Codex community.</strong>
</div>
