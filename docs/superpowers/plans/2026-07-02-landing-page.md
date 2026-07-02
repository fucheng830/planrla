# Planrla 产品官网 / 落地页（Landing Page）

> 立项日期：2026-07-02　|　状态：**计划中（未实现）**　|　关联：V1_PRODUCT_ROADMAP Milestone 6 / P1

## 背景

产品已开始公开发版（GitHub Release v0.1.0、飞书《Planrla 发布记录》已建），但**还没有面向用户的官网/落地页**。需要一个公开站点承载：

- 产品介绍（是什么、解决什么问题）
- 下载入口（桌面端各平台安装包 / GitHub Release 链接）
- 发布记录（changelog / 版本说明）
- 更新源元数据（对接 `NOMAD_UPDATE_CHECK_URL`）

## 现状（2026-07-02 核实）

- ❌ 落地页源码**不在本 workspace**。已搜：Cloudflare 相关 `wrangler.toml` 仅 `ai-relay/gateway`、`codex-worker`（均无关）；`planrla-cloud` 是后端（agent / worker / relay），不是落地页。
- ✅ 托管已定：**Cloudflare**（Pages）。
- ❌ 源码仓库、技术栈、内容、域名、部署管道均**未定**。

## 待决策（Open Questions）

- [ ] **技术栈**：静态站选型 —— Astro / Next.js (static) / VitePress / 纯 HTML？倾向 **Astro**（轻、快、SEO 好、原生支持多框架组件嵌入）。
- [ ] **源码仓库**：独立 repo（如 `planrla/landing`）还是放 `planrla-cloud` 下？倾向 **独立 repo**，Cloudflare Pages git-connected 自动部署，与 app 解耦。
- [ ] **域名**：`planrla.com` 是否已注册/解析到 Cloudflare？需要确认 DNS 状态。
- [ ] **内容范围（MVP）**：单页（hero + 功能 + 下载 + changelog）还是多页（+ 文档/定价）？倾向 **单页 MVP 起步**。
- [ ] **更新源对接**：落地页是否同时托管 `NOMAD_UPDATE_CHECK_URL` 的版本 JSON（release feed）？这决定桌面端自动更新链路。
- [ ] **品牌**：CloudCLI（商业品牌，`siteboon/claudecodeui` 的 release 用名）vs Planrla（OSS 名）—— 落地页走哪个品牌、是否需要双品牌。

## 建议阶段

### Phase 1 — 单页 MVP
- 敲定技术栈 + 建源码 repo
- 单页内容：hero、核心功能（含 FTS5 会话搜索等已发布特性）、下载入口（链 GitHub Release）、changelog 区（嵌飞书发布记录或 GitHub Release）
- Cloudflare Pages 部署 + 自定义域名解析
- **验收**：访问站点 → 看到产品介绍 + 下载 + v0.1.0 发布记录

### Phase 2 — 内容完善
- 多页（功能详情、文档入口、更新源 JSON endpoint）
- SEO + Open Graph + sitemap
- 正式对接 `NOMAD_UPDATE_CHECK_URL`（桌面端自动更新读这里）

### Phase 3 — 品牌 / 国际化
- CloudCLI / Planrla 双品牌策略落地
- 中英双语

## 部署说明（待 Phase 1 确认）

- Cloudflare Pages，git-connected（push → 自动构建部署），无需手动 `wrangler pages deploy`。
- 构建命令 + 输出目录随技术栈定（如 Astro：`npm run build` → `dist/`）。
- 环境变量 / Secrets 走 Cloudflare Pages 项目配置。

## 暂不实施的原因

落地页是独立产品级工作（技术栈选型、品牌、内容、SEO、域名），不应塞进当前 search / 发布收口里。先立项、定上述决策，再开 Phase 1。本计划仅为**记入 roadmap、不立即实现**。

## 参考

- GitHub Release：https://github.com/fucheng830/planrla/releases/tag/v0.1.0
- 飞书发布记录：https://my.feishu.cn/docx/LWKOdy5LuoXA4ExNua4c2G37nE3
- 飞书项目文件夹：https://my.feishu.cn/drive/folder/AQMDfG0fGlzCtUdJfvhcsEEnnVd
- `docs/commercial/RELEASE_CHECKLIST.md`（更新源 / 发布基建）
