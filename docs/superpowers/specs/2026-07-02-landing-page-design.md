# Planrla 产品官网（Landing Page）设计

> 日期：2026-07-02　|　状态：设计定稿，待实现　|　关联：`V1_PRODUCT_ROADMAP` P1、`docs/superpowers/plans/2026-07-02-landing-page.md`

## 背景

Planrla 已开始公开发版（v0.1.0、v0.2.0 含 Windows 安装包），但还没有面向用户的官网/落地页。本设计定义一个 Cloudflare Pages 托管的**单页站点**，承载：产品介绍、下载入口、更新日志展示，并托管桌面端自动更新所需的 release feed JSON。

## 目标

- 提供公开访问的产品介绍与下载入口（`planrla.com`）
- 托管桌面端自动更新元数据（`/desktop/latest.json`，对齐 `NOMAD_UPDATE_CHECK_URL` schema）
- 展示最近发版动态（Changelog 区，数据来自 GitHub Releases）
- 零维护：发版数据从 GitHub Releases 自动同步，无需手改

## 非目标（MVP 不做）

- 多页站点（独立文档站、定价页、博客）—— 后续 Phase
- 中英双语切换 —— MVP 用单一语言（中文文案）；英文文案与 i18n 切换器留后续 Phase
- 用户系统 / 后台 / 表单
- Open Graph / sitemap 等高级 SEO —— Phase 2
- 定时自动重建（cron）—— MVP 靠 push 触发 Pages 重建

## 决策汇总

| 维度 | 决策 | 理由 |
|------|------|------|
| 品牌 | Planrla | 与 `productName=Planrla` / `appId=cc.planrla.desktop` / `updates.planrla.com` 一致 |
| 域名 | `planrla.com`（已注册 + Cloudflare NS） | 已就绪，NS 为 `trace/meiling.ns.cloudflare.com` |
| 内容范围 | 单页 + release feed JSON | MVP 够用，顺手打通桌面更新链路 |
| 技术栈 | Astro（独立 package.json） | 零 JS 输出、SEO 强、内容站专用、可嵌 React |
| 源码位置 | 主 repo `landing/` 子目录 | 与 app 同仓便于版本联动；独立 package.json 不污染主项目构建 |
| 视觉风格 | 亮色 SaaS 风（白底 / 蓝主色 `#2563eb` / 无衬线） | 通用商务、干净专业 |
| 部署 | Cloudflare Pages，git-connected（push `main` → 自动构建 `landing/`） | 域名已在 Cloudflare |
| release feed | 方案 A：构建时 fetch GitHub Releases API | 零维护、单一数据源、Astro 原生能力 |

## 架构

### 目录结构（主 repo 内新增 `landing/`）

```
planrla/
└── landing/                       # 完全独立的 Astro 项目
    ├── package.json               # 独立依赖（astro 等），不碰主项目
    ├── astro.config.mjs           # site = https://planrla.com
    ├── tsconfig.json
    ├── public/
    │   ├── desktop/
    │   │   └── latest.json        # release feed（构建时覆盖；git 留兜底静态版）
    │   └── images/                # logo / og / screenshot
    └── src/
        ├── pages/index.astro      # 唯一页面（单页）
        ├── layouts/Base.astro     # <html> 骨架 + 全局样式
        ├── components/
        │   ├── Nav.astro
        │   ├── Hero.astro
        │   ├── Features.astro
        │   ├── Download.astro
        │   ├── Changelog.astro
        │   └── Footer.astro
        ├── data/releases.ts       # 构建时拉 GitHub Release 的逻辑
        └── styles/global.css      # 亮色 SaaS 风设计 token
```

**关键约束**：`landing/package.json` 完全独立。Cloudflare Pages 设 **Root directory = `landing`**，只装 landing 自己的依赖（astro 等），不会拉主项目的 electron / react / better-sqlite3（避免装依赖超时与 native 编译失败）。

### 单页结构（6 个 section，锚点导航）

1. **Nav** — logo（Planrla）· 锚点（功能 / 下载 / 更新日志）· GitHub 图标链接
2. **Hero** — 主标题 + 副标题 + 主 CTA「Download for Windows」+ provider 徽标（Claude / Codex / Gemini）
3. **Features** — 4 卡片网格：
   - 多 Provider 一体化（Claude / Codex / Gemini / Cursor 同一工作台）
   - 本地优先（本地跑模型、数据不离机）
   - 桌面原生体验（Electron、三态主题、自绘标题栏）
   - 会话全文搜索（FTS5、毫秒级检索）
4. **Download** — 各平台下载按钮，链 `github.com/fucheng830/planrla/releases/latest`，自动指向最新版
5. **Changelog** — 最近 5 个版本（version + 发布日期 + 摘要），从 GitHub Release 动态拉取
6. **Footer** — 版权 · GitHub · 隐私说明

### 数据流

```
GitHub Releases API
   │  build-time fetch（src/data/releases.ts）
   ├─→ public/desktop/latest.json   # release feed（最新版 5 字段）
   └─→ Changelog.astro              # 渲染最近 5 个版本
```

### release feed 机制（方案 A）

- **构建时**在 `src/data/releases.ts` 内 `fetch('https://api.github.com/repos/fucheng830/planrla/releases')`
- 生成 `public/desktop/latest.json`，schema 对齐 `NOMAD_UPDATE_CHECK_URL`（见 `docs/commercial/RELEASE_CHECKLIST.md`）：
  ```json
  {
    "version": "v0.2.0",
    "title": "v0.2.0 — 桌面端三态主题",
    "body": "<release notes markdown>",
    "htmlUrl": "https://github.com/fucheng830/planrla/releases/tag/v0.2.0",
    "publishedAt": "2026-07-02T10:43:00Z"
  }
  ```
- 同一份数据渲染 Changelog 区（最近 5 个 release）
- 桌面端配置 `NOMAD_UPDATE_CHECK_URL=https://planrla.com/desktop/latest.json` 即对接自动更新链路

### 部署配置（Cloudflare Pages）

| 项 | 值 |
|----|----|
| Framework preset | Astro |
| Root directory | `landing` |
| Build command | `npm run build` |
| Build output | `dist` |
| 自定义域名 | `planrla.com` + `www.planrla.com`（www CNAME → main） |
| 环境变量 | MVP 无（公开 repo 匿名 fetch；遇限流再加 `GITHUB_TOKEN`） |

## 错误处理与兜底

- **GitHub API 限流**（匿名 60 req/hr）：构建时不挂 —— fetch 失败则用 git 里留的静态 `latest.json` 兜底；Changelog 区用同一兜底数据渲染。
- **fetch 网络异常**：同上回退静态文件，构建必须成功。
- **Changelog 无数据**（兜底也为空）：渲染"暂无发布记录"占位，不报错。
- **`latest.json` 字段缺失**：构建时校验 5 字段齐全；缺失则用上一版兜底或跳过该条。

## 测试与验收

- [ ] `cd landing && npm run dev` 本地预览单页，6 个 section 正常
- [ ] `npm run build` 产出 `dist/index.html` + `dist/desktop/latest.json`
- [ ] `latest.json` 含 `version/title/body/htmlUrl/publishedAt` 5 字段
- [ ] 断网或 API 限流模拟：构建仍成功（走静态兜底）
- [ ] 亮色 SaaS 风落地（白底 / `#2563eb` 主色 / 无衬线）
- [ ] 移动端响应式（hero / features / download 在窄屏可读）
- [ ] 接入 `planrla.com` 后访问，看到完整单页 + Changelog 显示最近版本
- [ ] 桌面端设 `NOMAD_UPDATE_CHECK_URL=https://planrla.com/desktop/latest.json` 能拿到版本信息

## 风险与约束

- **GitHub API 限流**：兜底静态文件覆盖；后续如频繁构建可加 `GITHUB_TOKEN` 环境变量提升至 5000/hr。
- **主 repo 子目录构建**：`landing/` 必须完全独立 `package.json`；Cloudflare Pages Root directory 必须设 `landing`，否则会去装主项目依赖（electron 等）导致构建失败。
- **release feed 时效性**：发版后需一次 Pages 重建（push 到 main 触发）。MVP 接受这个延迟；如需发版即时更新，后续升级为 GitHub Action（方案 B：release published 时生成 JSON 推回仓库）。
- **品牌历史**：商业曾用名 CloudCLI（见 `docs/archive/2026-06-26-design.md`），本站统一 Planrla，不在落地页暴露 CloudCLI 双品牌。
- **主项目 `package.json` version 与 tag 双轨制**（见 memory `planrla-release-workflow`）：`latest.json.version` 取 GitHub Release 的 `tag_name`（如 `v0.2.0`），与发版 tag 一致，不依赖 `package.json` 的 `1.34.0`。

## 实现顺序提示（留给 writing-plans）

1. `landing/` Astro 项目骨架（独立 package.json + 最小 index.astro）
2. `src/data/releases.ts` 构建时 fetch + 兜底
3. 6 个 section 组件依次实现（Nav → Hero → Features → Download → Changelog → Footer）
4. 亮色 SaaS 设计 token + 响应式
5. `public/desktop/latest.json` 静态兜底
6. 本地 build 验收
7. Cloudflare Pages 接入 + 域名绑定（手动配置步骤写进 plan）
