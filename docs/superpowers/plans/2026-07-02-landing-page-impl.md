# Planrla Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主 repo `landing/` 子目录建一个独立 Astro 单页站点，承载产品介绍/下载/更新日志，并构建时从 GitHub Releases 生成 `/desktop/latest.json` release feed。

**Architecture:** `landing/` 是完全独立的 Astro 项目（自己的 package.json，不依赖主项目）。构建前先跑 `gen-feed` 脚本 fetch GitHub Releases API 生成 `latest.json`（fetch 失败走 git 静态兜底），再 Astro build 出纯静态站。部署走 Cloudflare Pages（Root=`landing`，git-connected）。

**Tech Stack:** Astro 5、TypeScript、tsx（跑 gen-feed 与 node:test）、原生 CSS（亮色 SaaS 风）。

**Spec:** `docs/superpowers/specs/2026-07-02-landing-page-design.md`

---

## 文件结构

**Create（全部在 `landing/` 子目录下，主 repo 新增）：**
- `landing/package.json` — 独立依赖（astro + tsx devDep）
- `landing/astro.config.mjs` — Astro 配置（site = planrla.com）
- `landing/tsconfig.json` — 继承 astro strict
- `landing/src/layouts/Base.astro` — `<html>` 骨架 + 全局样式引入
- `landing/src/styles/global.css` — 亮色 SaaS 设计 token + 基础重置
- `landing/src/pages/index.astro` — 唯一页面，组装 6 个 section
- `landing/src/data/releases.ts` — release 归一化纯函数 + fetchReleases（IO + 兜底）
- `landing/src/data/releases.test.ts` — node:test 单元测试（归一化纯函数）
- `landing/scripts/gen-feed.ts` — 构建前脚本：fetch + 写 `public/desktop/latest.json`
- `landing/public/desktop/latest.json` — release feed（git 留兜底静态版）
- `landing/src/components/{Nav,Hero,Features,Download,Changelog,Footer}.astro` — 6 个 section
- `landing/scripts/validate-feed.mjs` — 校验 latest.json schema（验收用）

**Modify:** 无（主 repo 现有文件不改；`landing/` 完全新增）

**环境约束:**
- 所有命令在 `landing/` 子目录内执行（`cd landing`）
- 主 repo `.gitignore` 已忽略 `node_modules` / `dist`（递归生效），`landing/node_modules` 与 `landing/dist` 自动忽略
- 纯函数测试用 `node:test`（与主项目一致，`tsx --test`）
- 提交前确认主 repo 根无 `nul` 文件（CLAUDE.md 规范）

---

## Task 1: Astro 项目骨架

**Files:**
- Create: `landing/package.json`
- Create: `landing/astro.config.mjs`
- Create: `landing/tsconfig.json`
- Create: `landing/src/layouts/Base.astro`
- Create: `landing/src/styles/global.css`
- Create: `landing/src/pages/index.astro`

- [ ] **Step 1: 写 `landing/package.json`**

```json
{
  "name": "planrla-landing",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "gen-feed": "tsx scripts/gen-feed.ts",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "validate": "node scripts/validate-feed.mjs",
    "check": "astro check"
  },
  "dependencies": {
    "astro": "^5.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0"
  }
}
```

> 注：Task 1 阶段 `build` = `astro build`。Task 3 会把 build 改为 `npm run gen-feed && astro build`（构建前先 fetch release feed）。

- [ ] **Step 2: 写 `landing/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://planrla.com',
});
```

- [ ] **Step 3: 写 `landing/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

- [ ] **Step 4: 写 `landing/src/styles/global.css`（亮色 SaaS 设计 token）**

```css
:root {
  --color-bg: #ffffff;
  --color-fg: #0f172a;
  --color-muted: #64748b;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-fg: #ffffff;
  --color-border: #e2e8f0;
  --color-surface: #f8fafc;
  --color-surface-2: #f1f5f9;
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --max-width: 1120px;
  --radius: 10px;
}

*, *::before, *::after { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--color-fg);
  background: var(--color-bg);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }
img { max-width: 100%; height: auto; display: block; }

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 24px;
}

.section { padding: 80px 0; }
.section-title { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 8px; }
.section-subtitle { color: var(--color-muted); font-size: 16px; margin: 0 0 40px; }

@media (max-width: 640px) {
  .container { padding: 0 16px; }
  .section { padding: 56px 0; }
  .section-title { font-size: 24px; }
}
```

- [ ] **Step 5: 写 `landing/src/layouts/Base.astro` + 占位 `index.astro`**

`landing/src/layouts/Base.astro`：
```astro
---
import '../styles/global.css';
interface Props { title: string; description?: string; }
const { title, description = 'Planrla — 面向开发者的本地优先 AI Agent 工作台' } = Astro.props;
---
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
  </head>
  <body>
    <slot />
  </body>
</html>
```

`landing/src/pages/index.astro`（占位，后续 task 填充）：
```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="Planrla — AI Agent 工作台">
  <main class="container" style="padding:80px 24px">
    <h1>Planrla</h1>
    <p>落地页构建中…</p>
  </main>
</Base>
```

- [ ] **Step 6: 安装依赖并验证 dev / build**

```bash
cd landing
npm install
npm run dev
# 浏览器访问 http://localhost:4321，看到 "Planrla / 落地页构建中…"
# Ctrl+C 退出 dev
npm run build
# 预期：dist/index.html 生成，无报错
```
Expected: dev 正常显示占位页；`npm run build` 产出 `dist/index.html`。

- [ ] **Step 7: Commit**

```bash
cd ..  # 回到 repo 根
git add landing/package.json landing/astro.config.mjs landing/tsconfig.json landing/src landing/package-lock.json
git commit -m "feat(landing): astro project skeleton (independent package.json)"
```

> 注意：`landing/node_modules` 与 `landing/dist` 被主 repo `.gitignore` 递归忽略，不会被提交。`package-lock.json` 要提交（锁定依赖）。

---

## Task 2: releases 纯函数 + 测试（TDD）

**Files:**
- Create: `landing/src/data/releases.ts`
- Test: `landing/src/data/releases.test.ts`

- [ ] **Step 1: 写失败测试**

`landing/src/data/releases.test.ts`：
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelease } from './releases.ts';

const OK = {
  tag_name: 'v0.2.0',
  name: 'v0.2.0 — 桌面端三态主题',
  body: '## 新功能',
  html_url: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
  published_at: '2026-07-02T10:43:00Z',
  draft: false,
  prerelease: false,
};

test('normalizeRelease: 正常 release 归一化为 5 字段', () => {
  assert.deepEqual(normalizeRelease(OK), {
    version: 'v0.2.0',
    title: 'v0.2.0 — 桌面端三态主题',
    body: '## 新功能',
    htmlUrl: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
    publishedAt: '2026-07-02T10:43:00Z',
  });
});

test('normalizeRelease: draft 返回 null', () => {
  assert.equal(normalizeRelease({ ...OK, draft: true }), null);
});

test('normalizeRelease: 缺 tag_name 或 html_url 返回 null', () => {
  assert.equal(normalizeRelease({ ...OK, tag_name: '' }), null);
  assert.equal(normalizeRelease({ ...OK, html_url: '' }), null);
});

test('normalizeRelease: name/body/published_at 为 null 时 fallback', () => {
  const r = normalizeRelease({ ...OK, name: null, body: null, published_at: null });
  assert.equal(r?.title, 'v0.2.0');   // name null → 用 tag_name
  assert.equal(r?.body, '');            // body null → 空串
  assert.equal(r?.publishedAt, '');     // published_at null → 空串
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd landing
npx tsx --test src/data/releases.test.ts
```
Expected: FAIL（`Cannot find module './releases.ts'`）

- [ ] **Step 3: 实现纯函数**

`landing/src/data/releases.ts`：
```ts
/**
 * Release 归一化纯函数 + 类型。IO（fetch）放在 fetchReleases，本文件只导出可测纯函数。
 * 对齐 NOMAD_UPDATE_CHECK_URL schema（见 docs/commercial/RELEASE_CHECKLIST.md）。
 */

export interface FeedEntry {
  version: string;       // tag_name, e.g. "v0.2.0"
  title: string;         // release name（null 时 fallback 到 tag_name）
  body: string;          // release body markdown（null → ''）
  htmlUrl: string;       // release html url
  publishedAt: string;   // published_at ISO（null → ''）
}

/** GitHub Release raw item 子集 */
interface RawRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

/**
 * 把 GitHub API 的 raw release 归一化为 FeedEntry。
 * draft 或缺关键字段（tag_name / html_url）返回 null，由调用方过滤。
 */
export function normalizeRelease(raw: RawRelease): FeedEntry | null {
  if (raw.draft) return null;
  if (!raw.tag_name || !raw.html_url) return null;
  return {
    version: raw.tag_name,
    title: raw.name || raw.tag_name,
    body: raw.body || '',
    htmlUrl: raw.html_url,
    publishedAt: raw.published_at || '',
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx tsx --test src/data/releases.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ..
git add landing/src/data/releases.ts landing/src/data/releases.test.ts
git commit -m "feat(landing): release normalize pure fns + tests"
```

---

## Task 3: fetchReleases + gen-feed 脚本 + 兜底 + prebuild 集成

**Files:**
- Modify: `landing/src/data/releases.ts`（追加 `fetchReleases`）
- Modify: `landing/package.json`（`build` 改为 `npm run gen-feed && astro build`）
- Create: `landing/scripts/gen-feed.ts`
- Create: `landing/public/desktop/latest.json`（兜底静态）

- [ ] **Step 1: 追加 `fetchReleases` 到 `releases.ts` + 改 build script**

在 `landing/src/data/releases.ts` 末尾追加：
```ts
const REPO = 'fucheng830/planrla';
const API_URL = `https://api.github.com/repos/${REPO}/releases`;

/** fetch 失败时的兜底（与 public/desktop/latest.json 静态版保持一致） */
export const STATIC_FALLBACK: FeedEntry = {
  version: 'v0.2.0',
  title: 'v0.2.0 — 桌面端三态主题',
  body: '桌面端外观设置新增 system / light / dark 三态主题切换。',
  htmlUrl: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
  publishedAt: '2026-07-02T10:43:00Z',
};

/**
 * 构建时 fetch GitHub Releases，返回归一化后的 FeedEntry[]（已过滤 draft/非法）。
 * fetch 失败（限流 / 断网）返回 [STATIC_FALLBACK]，构建不挂。
 * token 可选：传 GITHUB_TOKEN 提升匿名 60/hr 限流到 5000/hr。
 */
export async function fetchReleases(token?: string): Promise<FeedEntry[]> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'planrla-landing',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API_URL, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const raw = (await res.json()) as RawRelease[];
    const entries = raw.map(normalizeRelease).filter((r): r is FeedEntry => r !== null);
    if (entries.length === 0) throw new Error('no releases');
    return entries;
  } catch (e) {
    console.warn(`[releases] fetch failed (${(e as Error).message}), using static fallback`);
    return [STATIC_FALLBACK];
  }
}
```

然后改 `landing/package.json` 的 `build` 为：
```json
"build": "npm run gen-feed && astro build",
```
（Task 1 初始为 `astro build`，此处加 `gen-feed` 前缀，构建前先写 release feed）。

- [ ] **Step 2: 写兜底静态 `public/desktop/latest.json`**

`landing/public/desktop/latest.json`：
```json
{
  "version": "v0.2.0",
  "title": "v0.2.0 — 桌面端三态主题",
  "body": "桌面端外观设置新增 system / light / dark 三态主题切换。\n\n- feat(theme): theme mode pure fns (system/light/dark)\n- feat(theme): three-state theme context\n- feat(theme): theme mode selector control\n- feat(theme): appearance tab + i18n (11 locales)",
  "htmlUrl": "https://github.com/fucheng830/planrla/releases/tag/v0.2.0",
  "publishedAt": "2026-07-02T10:43:00Z"
}
```

- [ ] **Step 3: 写 `scripts/gen-feed.ts`**

`landing/scripts/gen-feed.ts`：
```ts
// 构建前脚本：fetch GitHub Releases，把最新版写入 public/desktop/latest.json。
// fetch 失败时静默保留 git 中的兜底静态文件（gen-feed 不覆盖），构建不挂。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchReleases } from '../src/data/releases.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED_PATH = resolve(__dirname, '../public/desktop/latest.json');
const token = process.env.GITHUB_TOKEN;

const entries = await fetchReleases(token);
const latest = entries[0];

writeFileSync(FEED_PATH, JSON.stringify(latest, null, 2) + '\n');
console.log(`[gen-feed] wrote latest.json → ${latest.version}`);
```

- [ ] **Step 4: 验证 gen-feed 正常工作**

```bash
cd landing
npm run gen-feed
```
Expected: 输出 `[gen-feed] wrote latest.json → vX.X.X`（实际最新 tag）。`public/desktop/latest.json` 内容更新为 GitHub 最新 release。如果限流，输出 `[releases] fetch failed (...), using static fallback` 并写入兜底 v0.2.0。

- [ ] **Step 5: 验证完整 build（gen-feed + astro build）**

```bash
npm run build
```
Expected: 先跑 gen-feed 写 latest.json，再 astro build 产出 `dist/index.html` + `dist/desktop/latest.json`。无报错。

- [ ] **Step 6: Commit**

```bash
cd ..
git add landing/src/data/releases.ts landing/scripts/gen-feed.ts landing/public/desktop/latest.json landing/package.json
git commit -m "feat(landing): gen-feed script + static fallback for release feed"
```

---

## Task 4: Nav + Footer 组件

**Files:**
- Create: `landing/src/components/Nav.astro`
- Create: `landing/src/components/Footer.astro`

- [ ] **Step 1: 写 `Nav.astro`**

`landing/src/components/Nav.astro`：
```astro
---
const links = [
  { href: '#features', label: '功能' },
  { href: '#download', label: '下载' },
  { href: '#changelog', label: '更新日志' },
];
---
<header class="nav">
  <div class="container nav-inner">
    <a href="/" class="brand">
      <span class="brand-mark"></span>
      <span>Planrla</span>
    </a>
    <nav class="nav-links">
      {links.map((l) => <a href={l.href}>{l.label}</a>)}
    </nav>
    <a class="nav-gh" href="https://github.com/fucheng830/planrla" target="_blank" rel="noopener" aria-label="GitHub">GitHub ↗</a>
  </div>
</header>

<style>
  .nav {
    position: sticky; top: 0; z-index: 10;
    background: rgba(255,255,255,0.85);
    backdrop-filter: saturate(180%) blur(8px);
    border-bottom: 1px solid var(--color-border);
  }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; height: 60px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; }
  .brand-mark { width: 22px; height: 22px; border-radius: 6px; background: var(--color-primary); }
  .nav-links { display: flex; gap: 24px; }
  .nav-links a { color: var(--color-muted); font-size: 14px; font-weight: 500; }
  .nav-links a:hover { color: var(--color-fg); }
  .nav-gh { font-size: 13px; font-weight: 600; color: var(--color-primary); }
  @media (max-width: 640px) {
    .nav-links { display: none; }
  }
</style>
```

- [ ] **Step 2: 写 `Footer.astro`**

`landing/src/components/Footer.astro`：
```astro
---
const year = new Date().getFullYear();
---
<footer class="footer">
  <div class="container footer-inner">
    <span>© {year} Planrla</span>
    <div class="footer-links">
      <a href="https://github.com/fucheng830/planrla" target="_blank" rel="noopener">GitHub</a>
      <a href="https://github.com/fucheng830/planrla/releases">Releases</a>
    </div>
  </div>
</footer>

<style>
  .footer { border-top: 1px solid var(--color-border); padding: 32px 0; color: var(--color-muted); font-size: 14px; }
  .footer-inner { display: flex; align-items: center; justify-content: space-between; }
  .footer-links { display: flex; gap: 20px; }
  .footer-links a:hover { color: var(--color-fg); }
  @media (max-width: 640px) {
    .footer-inner { flex-direction: column; gap: 12px; }
  }
</style>
```

- [ ] **Step 3: 暂时接入 index.astro 验证**

修改 `landing/src/pages/index.astro`：
```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Planrla — AI Agent 工作台">
  <Nav />
  <main class="container" style="padding:80px 24px; min-height:60vh">
    <h1>Planrla</h1>
    <p>落地页构建中…</p>
  </main>
  <Footer />
</Base>
```

- [ ] **Step 4: 本地验证**

```bash
cd landing
npm run dev
# 访问 http://localhost:4321，确认顶部 Nav（logo + 锚点 + GitHub）、底部 Footer 显示
```
Expected: Nav sticky 吸顶、Footer 在底，亮色 SaaS 风格。

- [ ] **Step 5: Commit**

```bash
cd ..
git add landing/src/components/Nav.astro landing/src/components/Footer.astro landing/src/pages/index.astro
git commit -m "feat(landing): Nav + Footer chrome components"
```

---

## Task 5: Hero 组件

**Files:**
- Create: `landing/src/components/Hero.astro`
- Modify: `landing/src/pages/index.astro`（接入 Hero）

- [ ] **Step 1: 写 `Hero.astro`**

`landing/src/components/Hero.astro`：
```astro
---
const providers = ['Claude', 'Codex', 'Gemini', 'Cursor'];
---
<section class="hero">
  <div class="container hero-inner">
    <h1 class="hero-title">面向开发者的<br /><span>AI Agent 工作台</span></h1>
    <p class="hero-sub">本地优先 · 多 Provider 一体化 · 桌面原生体验。<br />在一个工作台里同时驱动 Claude、Codex、Gemini。</p>
    <div class="hero-cta">
      <a class="btn btn-primary" href="#download">下载 Windows 版</a>
      <a class="btn btn-ghost" href="https://github.com/fucheng830/planrla" target="_blank" rel="noopener">查看 GitHub ↗</a>
    </div>
    <div class="hero-providers">
      {providers.map((p) => <span class="provider-chip">{p}</span>)}
    </div>
  </div>
</section>

<style>
  .hero { padding: 96px 0 72px; text-align: center; }
  .hero-inner { max-width: 760px; }
  .hero-title { font-size: 48px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin: 0 0 20px; }
  .hero-title span { color: var(--color-primary); }
  .hero-sub { font-size: 18px; color: var(--color-muted); margin: 0 0 32px; }
  .hero-cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 12px 22px; border-radius: var(--radius); font-weight: 600; font-size: 15px; transition: background .15s; }
  .btn-primary { background: var(--color-primary); color: var(--color-primary-fg); }
  .btn-primary:hover { background: var(--color-primary-hover); }
  .btn-ghost { border: 1px solid var(--color-border); color: var(--color-fg); }
  .btn-ghost:hover { background: var(--color-surface); }
  .hero-providers { display: flex; gap: 8px; justify-content: center; margin-top: 36px; flex-wrap: wrap; }
  .provider-chip { font-size: 12px; font-weight: 600; color: var(--color-muted); background: var(--color-surface-2); padding: 5px 12px; border-radius: 999px; }
  @media (max-width: 640px) {
    .hero { padding: 64px 0 48px; }
    .hero-title { font-size: 34px; }
    .hero-sub { font-size: 16px; }
  }
</style>
```

- [ ] **Step 2: 接入 index.astro**

`landing/src/pages/index.astro` 在 `<Nav />` 后、`<main>` 处替换为：
```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Hero from '../components/Hero.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Planrla — AI Agent 工作台">
  <Nav />
  <main>
    <Hero />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 3: 本地验证**

```bash
cd landing && npm run dev
```
Expected: Hero 居中，主标题（蓝色强调"AI Agent 工作台"）+ 副标题 + 两 CTA 按钮 + provider 徽标。窄屏字号缩小、按钮换行。

- [ ] **Step 4: Commit**

```bash
cd ..
git add landing/src/components/Hero.astro landing/src/pages/index.astro
git commit -m "feat(landing): Hero section with CTAs + provider chips"
```

---

## Task 6: Features 组件（4 卡片）

**Files:**
- Create: `landing/src/components/Features.astro`
- Modify: `landing/src/pages/index.astro`（接入）

- [ ] **Step 1: 写 `Features.astro`**

`landing/src/components/Features.astro`：
```astro
---
const features = [
  { title: '多 Provider 一体化', desc: 'Claude、Codex、Gemini、Cursor 在同一工作台切换，共享会话与项目。', icon: '⇄' },
  { title: '本地优先', desc: '本地运行模型 CLI，凭据与数据不离机；远程访问按需开启。', icon: '⌂' },
  { title: '桌面原生体验', desc: 'Electron 桌面端，三态主题、自绘标题栏、系统级集成。', icon: '▥' },
  { title: '会话全文搜索', desc: 'FTS5 全文索引，跨会话毫秒级检索历史对话。', icon: '⌕' },
];
---
<section id="features" class="section">
  <div class="container">
    <h2 class="section-title">核心功能</h2>
    <p class="section-subtitle">为高频 AI 编程协作而设计</p>
    <div class="grid">
      {features.map((f) => (
        <div class="card">
          <div class="card-icon" aria-hidden="true">{f.icon}</div>
          <h3>{f.title}</h3>
          <p>{f.desc}</p>
        </div>
      ))}
    </div>
  </div>
</section>

<style>
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 24px; }
  .card-icon { width: 36px; height: 36px; border-radius: 8px; background: var(--color-primary); color: var(--color-primary-fg); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; margin-bottom: 14px; }
  .card h3 { font-size: 16px; font-weight: 700; margin: 0 0 8px; }
  .card p { font-size: 14px; color: var(--color-muted); margin: 0; line-height: 1.55; }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: 接入 index.astro（Hero 后加 Features）**

`index.astro` 的 `<main>` 内，`<Hero />` 之后加：
```astro
<Features />
```
并在 frontmatter import 区加 `import Features from '../components/Features.astro';`

- [ ] **Step 3: 本地验证**

```bash
cd landing && npm run dev
```
Expected: Features 区 4 卡片网格（桌面 4 列 / 平板 2 列 / 手机 1 列），每卡片 icon + 标题 + 描述。

- [ ] **Step 4: Commit**

```bash
cd ..
git add landing/src/components/Features.astro landing/src/pages/index.astro
git commit -m "feat(landing): Features section (4 cards, responsive grid)"
```

---

## Task 7: Download 组件

**Files:**
- Create: `landing/src/components/Download.astro`
- Modify: `landing/src/pages/index.astro`（接入）

- [ ] **Step 1: 写 `Download.astro`**

`landing/src/components/Download.astro`：
```astro
---
// 链接到 GitHub Release latest，自动指向最新版安装包
const LATEST = 'https://github.com/fucheng830/planrla/releases/latest';
const RELEASES = 'https://github.com/fucheng830/planrla/releases';
const platforms = [
  { label: 'Windows', detail: '.exe 安装包', href: LATEST, primary: true },
  { label: 'macOS', detail: '即将上线', href: RELEASES, primary: false },
  { label: 'Linux', detail: '即将上线', href: RELEASES, primary: false },
];
---
<section id="download" class="section" style="background:var(--color-surface)">
  <div class="container download-inner">
    <h2 class="section-title">下载 Planrla</h2>
    <p class="section-subtitle">免费开始使用，本地优先</p>
    <div class="download-grid">
      {platforms.map((p) => (
        <a class={p.primary ? 'dl-card dl-card-primary' : 'dl-card'} href={p.href} target="_blank" rel="noopener">
          <span class="dl-label">{p.label}</span>
          <span class="dl-detail">{p.detail}</span>
        </a>
      ))}
    </div>
    <p class="download-note">所有平台安装包见 <a href={RELEASES}>GitHub Releases</a></p>
  </div>
</section>

<style>
  .download-inner { text-align: center; }
  .download-grid { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
  .dl-card { display: flex; flex-direction: column; gap: 4px; padding: 22px 28px; border-radius: var(--radius); border: 1px solid var(--color-border); background: var(--color-bg); min-width: 160px; }
  .dl-card-primary { background: var(--color-primary); color: var(--color-primary-fg); border-color: var(--color-primary); }
  .dl-card-primary:hover { background: var(--color-primary-hover); }
  .dl-card:not(.dl-card-primary):hover { background: var(--color-surface-2); }
  .dl-label { font-size: 17px; font-weight: 700; }
  .dl-detail { font-size: 13px; opacity: .85; }
  .download-note { margin-top: 24px; font-size: 13px; color: var(--color-muted); }
  .download-note a { color: var(--color-primary); text-decoration: underline; }
</style>
```

- [ ] **Step 2: 接入 index.astro**

frontmatter 加 `import Download from '../components/Download.astro';`，`<main>` 内 Features 后加 `<Download />`。

- [ ] **Step 3: 本地验证**

```bash
cd landing && npm run dev
```
Expected: Download 区 3 平台卡片，Windows 高亮蓝底主卡，链接指向 GitHub Release latest。

- [ ] **Step 4: Commit**

```bash
cd ..
git add landing/src/components/Download.astro landing/src/pages/index.astro
git commit -m "feat(landing): Download section linking GitHub Releases"
```

---

## Task 8: Changelog 组件（构建时拉取数据）

**Files:**
- Create: `landing/src/components/Changelog.astro`
- Modify: `landing/src/pages/index.astro`（接入）

- [ ] **Step 1: 写 `Changelog.astro`（frontmatter 构建时调 fetchReleases）**

`landing/src/components/Changelog.astro`：
```astro
---
import { fetchReleases } from '../data/releases.ts';
// build 时拉取（fetch 失败走 STATIC_FALLBACK，不挂构建）
const entries = (await fetchReleases(process.env.GITHUB_TOKEN)).slice(0, 5);
const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
---
<section id="changelog" class="section">
  <div class="container">
    <h2 class="section-title">更新日志</h2>
    <p class="section-subtitle">来自 GitHub Releases</p>
    {entries.length === 0 ? (
      <p class="empty">暂无发布记录</p>
    ) : (
      <ul class="log">
        {entries.map((e) => (
          <li class="log-item">
            <div class="log-meta">
              <span class="log-version">{e.version}</span>
              <span class="log-date">{fmtDate(e.publishedAt)}</span>
            </div>
            <a class="log-title" href={e.htmlUrl} target="_blank" rel="noopener">{e.title}</a>
          </li>
        ))}
      </ul>
    )}
    <p class="log-more"><a href="https://github.com/fucheng830/planrla/releases">查看全部版本 →</a></p>
  </div>
</section>

<style>
  .log { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--color-border); }
  .log-item { display: flex; align-items: baseline; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--color-border); }
  .log-meta { min-width: 160px; display: flex; flex-direction: column; gap: 2px; }
  .log-version { font-weight: 700; font-size: 15px; }
  .log-date { font-size: 12px; color: var(--color-muted); }
  .log-title { font-size: 15px; color: var(--color-fg); }
  .log-title:hover { color: var(--color-primary); }
  .empty { color: var(--color-muted); }
  .log-more { margin-top: 24px; font-size: 14px; }
  .log-more a { color: var(--color-primary); }
  @media (max-width: 640px) {
    .log-item { flex-direction: column; gap: 4px; }
    .log-meta { flex-direction: row; gap: 12px; align-items: baseline; }
  }
</style>
```

- [ ] **Step 2: 接入 index.astro**

frontmatter 加 `import Changelog from '../components/Changelog.astro';`，`<main>` 内 Download 后加 `<Changelog />`。

- [ ] **Step 3: 本地验证（注意 dev 模式也会触发 fetch）**

```bash
cd landing && npm run dev
```
Expected: Changelog 区显示最近版本列表（version + 日期 + 标题，链 release）。若被 GitHub API 限流，回退到兜底 v0.2.0 单条。

- [ ] **Step 4: Commit**

```bash
cd ..
git add landing/src/components/Changelog.astro landing/src/pages/index.astro
git commit -m "feat(landing): Changelog section (build-time fetch GitHub Releases)"
```

---

## Task 9: index.astro 完整组装 + 响应式验收

**Files:**
- Modify: `landing/src/pages/index.astro`

- [ ] **Step 1: 确认 index.astro 最终形态**

`landing/src/pages/index.astro` 应为：
```astro
---
import Base from '../layouts/Base.astro';
import Nav from '../components/Nav.astro';
import Hero from '../components/Hero.astro';
import Features from '../components/Features.astro';
import Download from '../components/Download.astro';
import Changelog from '../components/Changelog.astro';
import Footer from '../components/Footer.astro';
---
<Base title="Planrla — 面向开发者的 AI Agent 工作台">
  <Nav />
  <main>
    <Hero />
    <Features />
    <Download />
    <Changelog />
  </main>
  <Footer />
</Base>
```

- [ ] **Step 2: 本地完整预览 + 响应式检查**

```bash
cd landing && npm run dev
```
在浏览器逐项验收：
- 桌面宽（≥1024px）：6 个 section 顺序渲染，Nav 吸顶，Features 4 列，Download 居中三卡
- 平板（~768px）：Features 变 2 列
- 手机（≤640px）：Nav 隐藏锚点链接、Features 1 列、Hero 字号缩小、Changelog 项纵向堆叠
- 各锚点（#features / #download / #changelog）跳转正常

Expected: 所有响应式断点表现符合预期，无样式溢出/错位。

- [ ] **Step 3: build 类型检查**

```bash
npx astro check
npm run build
```
Expected: `astro check` 无类型错误；`npm run build` 产出 `dist/index.html` + `dist/desktop/latest.json`。

- [ ] **Step 4: Commit（如有调整）**

```bash
cd ..
git add landing/src/pages/index.astro
# 仅当本步有改动才 commit；否则跳过
git commit -m "feat(landing): assemble all sections on index page"
```

---

## Task 10: build 验收 + latest.json schema 校验脚本

**Files:**
- Create: `landing/scripts/validate-feed.mjs`

- [ ] **Step 1: 写 schema 校验脚本**

`landing/scripts/validate-feed.mjs`：
```js
// 校验 dist/desktop/latest.json 含 5 字段且类型正确。CI / 本地验收用。
import { readFileSync } from 'node:fs';
const raw = readFileSync(new URL('../dist/desktop/latest.json', import.meta.url), 'utf8');
const feed = JSON.parse(raw);
const required = ['version', 'title', 'body', 'htmlUrl', 'publishedAt'];
const missing = required.filter((k) => typeof feed[k] !== 'string');
if (missing.length) {
  console.error(`✗ latest.json missing/non-string: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`✓ latest.json valid → ${feed.version}`);
```

- [ ] **Step 2: 完整 build + 校验**

```bash
cd landing
npm run build
npm run validate
```
Expected: `npm run build` 产出 `dist/index.html` + `dist/desktop/latest.json`；`npm run validate` 输出 `✓ latest.json valid → vX.X.X`。

- [ ] **Step 3: 模拟限流/断网验证兜底**

临时把 `gen-feed` 内 API URL 改成无效地址（如 `https://api.github.com/repos/fucheng830/planrla___invalid/releases`），跑 `npm run build`：
Expected: 输出 `[releases] fetch failed (..., using static fallback)`，构建仍成功，`dist/desktop/latest.json` 为兜底 v0.2.0 内容，`npm run validate` 仍通过。验证后改回正确 URL。

- [ ] **Step 4: Commit**

```bash
cd ..
git add landing/scripts/validate-feed.mjs landing/package.json
git commit -m "test(landing): feed schema validation script"
```

> 注：Task 1 创建 package.json 时 `validate` script 已写入。若未写，本 Step 2 前补上 `"validate": "node scripts/validate-feed.mjs"`。

---

## Task 11: Cloudflare Pages 接入 + 域名绑定（手动步骤）

> 本 task 是手动操作（Cloudflare 控制台），非代码。执行者按步骤操作并记录结果。

- [ ] **Step 1: 连接 GitHub 仓库到 Cloudflare Pages**

登录 Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git：
- 选择仓库 `fucheng830/planrla`
- Project name: `planrla`
- Production branch: `main`

- [ ] **Step 2: 配置构建设置**

| 项 | 值 |
|----|----|
| Framework preset | Astro |
| Root directory | `landing` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | （MVP 留空；如遇 GitHub API 限流，加 `GITHUB_TOKEN`） |

点击 Save and Deploy。等待首次构建完成。

Expected: 构建成功，得到 `*.pages.dev` 预览域名，访问可见完整单页。

- [ ] **Step 3: 绑定自定义域名**

Pages 项目 → Custom domains → Set up a domain：
- 添加 `planrla.com`（Cloudflare 已托管 NS，自动 CNAME）
- 添加 `www.planrla.com`（设为 redirect to `planrla.com`，或 CNAME → main）

等待 DNS 生效（通常几分钟）。

Expected: 访问 `https://planrla.com` 显示落地页，HTTPS 证书自动签发。

- [ ] **Step 4: 验证 release feed 可访问**

```bash
curl https://planrla.com/desktop/latest.json
```
Expected: 返回 5 字段 JSON，version 为最新 tag。

- [ ] **Step 5: 桌面端对接（可选，记录在案）**

桌面端构建配置 `NOMAD_UPDATE_CHECK_URL=https://planrla.com/desktop/latest.json`（或 `.env`）。下次桌面端发版后，push 任意 commit 到 main 触发 Pages 重建，latest.json 更新。

- [ ] **Step 6: 记录部署信息**

在 `docs/superpowers/plans/2026-07-02-landing-page-impl.md` 末尾或 `docs/commercial/RELEASE_CHECKLIST.md` 记录：
- Pages 项目名 / 预览域名 / 自定义域名
- 构建配置（Root=landing）
- release feed URL：`https://planrla.com/desktop/latest.json`

---

## 验收清单（对齐 spec 测试与验收）

- [ ] `cd landing && npm run dev` 本地预览，6 个 section 正常
- [ ] `npm run build` 产出 `dist/index.html` + `dist/desktop/latest.json`
- [ ] `npm run validate` 通过（latest.json 5 字段齐全）
- [ ] `npx tsx --test src/data/releases.test.ts` 全绿（4 tests）
- [ ] 断网模拟：构建仍成功（走静态兜底）
- [ ] 亮色 SaaS 风（白底 / `#2563eb` 主色 / 无衬线）落地
- [ ] 移动端响应式（hero / features / download 在窄屏可读）
- [ ] Cloudflare Pages 接入后，访问 `planrla.com` 看到完整单页 + Changelog
- [ ] `curl https://planrla.com/desktop/latest.json` 返回有效 5 字段 JSON

## 风险与回退

- **GitHub API 限流**：`fetchReleases` 内 try/catch 回退 `STATIC_FALLBACK`；gen-feed 不覆盖兜底文件时构建仍可产出（兜底已在 git）。升级：Cloudflare 环境变量加 `GITHUB_TOKEN`。
- **Cloudflare 误用主 repo 根构建**：必须设 Root=`landing`，否则装主项目 electron 等依赖会失败/超时。本 plan Step 2 明确标注。
- **release feed 时效**：发版后需 push 触发重建（或 Cloudflare 控制台手动 redeploy）。后续如需即时，升级为 GitHub Action（方案 B）。
- **组件样式 scoped 冲突**：各组件用 Astro scoped `<style>`，互不影响；全局 token 在 `global.css`。
