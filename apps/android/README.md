# Nomad — Planrla Mobile

Mobile client for Planrla — remote control for your Claude Code / Codex endpoints.

## Features

- **Multi-provider chat**: Claude, Codex, Cursor, Gemini, OpenCode — streaming with tool cards, thinking blocks, permission approvals
- **Multi-device**: Switch between execution endpoints (LAN-direct + cloud relay), QR code import
- **Files**: Browse, edit, upload, download, rename, delete
- **Git**: Status, commit, branch, push/pull/fetch, diff, discard
- **Search**: SSE full-text conversation search
- **Shell**: Interactive terminal (xterm.js + WebView)
- **Auto-update**: Checks GitHub Releases on launch, downloads + installs APK

## Build

```bash
# Build debug APK
.\build.bat

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Tech Stack

- Kotlin + Jetpack Compose + Material 3
- OkHttp WebSocket (chat.* protocol)
- Retrofit (REST API)
- DataStore (settings persistence)
- mikepenz multiplatform-markdown-renderer

## Architecture

```
data/           Network layer (API, WS, SSE, models, token store)
  ApiService.kt    Retrofit interfaces (Auth/Project/Session/Git/Command/...)
  Net.kt           OkHttp client + interceptors + ChatSocket
  ChatEvent.kt     WS event types + NormalizedMessage mapping
  Models.kt        Data classes (requests, responses, devices, sessions)
  SseSearch.kt     Standalone SSE client for conversation search
  UpdateChecker.kt GitHub Releases auto-update
  TokenStore.kt    DataStore-backed credential/settings persistence

ui/             Compose UI
  ChatScreen.kt    Main chat VM + composables (messages, composer, tools, code blocks)
  ProjectsScreen.kt Sidebar (projects, conversations, archive, search, device switcher)
  FilesScreen.kt   File browser + editor + upload
  ConnectScreen.kt Login (cloud account via api.planrla.com)
  SettingsScreen.kt Full settings (API keys, GitHub creds, git config)
  ExtensionsScreen.kt Provider capability viewer (MCP/Models/Skills/Plugins)
  ShellView.kt     Terminal (WebView + xterm.js)
  AppContainer.kt  Process singletons (App, SettingsHolder, ChatItem)
  Theme.kt         Material 3 color schemes (shadcn palette)
```

## Protocol

Uses the `chat.*` WebSocket protocol (Planrla fork v1.34.0+):
- `chat.send` / `chat.subscribe` / `chat.abort` / `chat.permission-response`
- Server-side `chatRunRegistry` with seq-based replay for background runs
- REST `POST /api/providers/sessions` creates stable session IDs before first send

## License

Proprietary. All rights reserved.
