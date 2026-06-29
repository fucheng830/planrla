# Third-Party License Audit

Generated from `package.json` and `package-lock.json` on 2026-06-29.

## Summary

- Runtime dependencies: 60
- Development dependencies: 40
- Low-risk permissive: 96
- Needs legal review: 1
- High-risk copyleft: 3

## Commercialization Guidance

- Treat this document as an engineering inventory, not legal advice.
- Keep runtime copyleft dependencies out of proprietary distribution unless counsel approves the obligations.
- Preserve third-party notices for permissive dependencies where required by their licenses.
- Re-run this audit before each commercial release and after dependency upgrades.

## High-Risk Copyleft Dependencies

| Package | Scope | Version | License |
|---|---|---:|---|
| `dompurify` | runtime | 3.4.7 | (MPL-2.0 OR Apache-2.0) |
| `jszip` | runtime | 3.10.1 | (MIT OR GPL-3.0-or-later) |
| `web-push` | runtime | 3.6.7 | MPL-2.0 |

## Dependencies Requiring Manual Review

| Package | Scope | Version | License |
|---|---|---:|---|
| `@anthropic-ai/claude-agent-sdk` | runtime | 0.3.165 | SEE LICENSE IN README.md |

## Direct Dependency Inventory

| Package | Scope | Version | License | Risk |
|---|---|---:|---|---|
| `@anthropic-ai/claude-agent-sdk` | runtime | 0.3.165 | SEE LICENSE IN README.md | review |
| `@codemirror/lang-css` | runtime | 6.3.1 | MIT | low |
| `@codemirror/lang-html` | runtime | 6.4.9 | MIT | low |
| `@codemirror/lang-javascript` | runtime | 6.2.4 | MIT | low |
| `@codemirror/lang-json` | runtime | 6.0.2 | MIT | low |
| `@codemirror/lang-markdown` | runtime | 6.3.3 | MIT | low |
| `@codemirror/lang-python` | runtime | 6.2.1 | MIT | low |
| `@codemirror/merge` | runtime | 6.11.1 | MIT | low |
| `@codemirror/theme-one-dark` | runtime | 6.1.3 | MIT | low |
| `@commitlint/cli` | development | 20.5.0 | MIT | low |
| `@commitlint/config-conventional` | development | 20.5.0 | MIT | low |
| `@eslint/js` | development | 9.39.3 | MIT | low |
| `@iarna/toml` | runtime | 2.2.5 | ISC | low |
| `@octokit/rest` | runtime | 22.0.0 | MIT | low |
| `@openai/codex` | runtime | 0.142.3 | Apache-2.0 | low |
| `@openai/codex-sdk` | runtime | 0.142.3 | Apache-2.0 | low |
| `@release-it/conventional-changelog` | development | 10.0.5 | MIT | low |
| `@replit/codemirror-minimap` | runtime | 0.5.2 | MIT | low |
| `@tailwindcss/typography` | runtime | 0.5.16 | MIT | low |
| `@types/better-sqlite3` | development | 7.6.13 | MIT | low |
| `@types/cross-spawn` | development | 6.0.6 | MIT | low |
| `@types/express` | development | 5.0.6 | MIT | low |
| `@types/node` | development | 22.19.7 | MIT | low |
| `@types/react` | development | 18.3.23 | MIT | low |
| `@types/react-dom` | development | 18.3.7 | MIT | low |
| `@types/ws` | development | 8.18.1 | MIT | low |
| `@uiw/react-codemirror` | runtime | 4.24.1 | MIT | low |
| `@vitejs/plugin-react` | development | 4.7.0 | MIT | low |
| `@vscode/ripgrep` | runtime | 1.17.1 | MIT | low |
| `@xterm/addon-clipboard` | runtime | 0.1.0 | MIT | low |
| `@xterm/addon-fit` | runtime | 0.10.0 | MIT | low |
| `@xterm/addon-web-links` | runtime | 0.11.0 | MIT | low |
| `@xterm/addon-webgl` | runtime | 0.18.0 | MIT | low |
| `@xterm/xterm` | runtime | 5.5.0 | MIT | low |
| `auto-changelog` | development | 2.5.0 | MIT | low |
| `autoprefixer` | development | 10.4.21 | MIT | low |
| `bcrypt` | runtime | 6.0.0 | MIT | low |
| `better-sqlite3` | runtime | 12.6.2 | MIT | low |
| `chokidar` | runtime | 4.0.3 | MIT | low |
| `class-variance-authority` | runtime | 0.7.1 | Apache-2.0 | low |
| `clsx` | runtime | 2.1.1 | MIT | low |
| `cmdk` | runtime | 1.1.1 | MIT | low |
| `concurrently` | development | 8.2.2 | MIT | low |
| `cors` | runtime | 2.8.5 | MIT | low |
| `cross-env` | development | 10.1.0 | MIT | low |
| `cross-spawn` | runtime | 7.0.6 | MIT | low |
| `dompurify` | runtime | 3.4.7 | (MPL-2.0 OR Apache-2.0) | high |
| `electron` | development | 38.8.6 | MIT | low |
| `electron-builder` | development | 26.15.3 | MIT | low |
| `electron-updater` | runtime | 6.8.9 | MIT | low |
| `eslint` | development | 9.39.3 | MIT | low |
| `eslint-import-resolver-typescript` | development | 4.4.4 | ISC | low |
| `eslint-plugin-boundaries` | development | 6.0.2 | MIT | low |
| `eslint-plugin-import-x` | development | 4.16.1 | MIT | low |
| `eslint-plugin-react` | development | 7.37.5 | MIT | low |
| `eslint-plugin-react-hooks` | development | 7.0.1 | MIT | low |
| `eslint-plugin-react-refresh` | development | 0.5.2 | MIT | low |
| `eslint-plugin-tailwindcss` | development | 3.18.2 | MIT | low |
| `eslint-plugin-unused-imports` | development | 4.4.1 | MIT | low |
| `express` | runtime | 4.21.2 | MIT | low |
| `fuse.js` | runtime | 7.1.0 | Apache-2.0 | low |
| `globals` | development | 17.4.0 | MIT | low |
| `gray-matter` | runtime | 4.0.3 | MIT | low |
| `husky` | development | 9.1.7 | MIT | low |
| `i18next` | runtime | 25.7.4 | MIT | low |
| `i18next-browser-languagedetector` | runtime | 8.2.0 | MIT | low |
| `jsonwebtoken` | runtime | 9.0.2 | MIT | low |
| `jszip` | runtime | 3.10.1 | (MIT OR GPL-3.0-or-later) | high |
| `katex` | runtime | 0.16.25 | MIT | low |
| `lint-staged` | development | 16.3.2 | MIT | low |
| `lucide-react` | runtime | 0.515.0 | ISC | low |
| `mime-types` | runtime | 3.0.1 | MIT | low |
| `multer` | runtime | 2.0.2 | MIT | low |
| `node-fetch` | runtime | 2.7.0 | MIT | low |
| `node-gyp` | development | 10.3.1 | MIT | low |
| `node-pty` | runtime | 1.2.0-beta.12 | MIT | low |
| `postcss` | development | 8.5.6 | MIT | low |
| `react` | runtime | 18.3.1 | MIT | low |
| `react-dom` | runtime | 18.3.1 | MIT | low |
| `react-dropzone` | runtime | 14.3.8 | MIT | low |
| `react-error-boundary` | runtime | 4.1.2 | MIT | low |
| `react-i18next` | runtime | 16.5.3 | MIT | low |
| `react-markdown` | runtime | 10.1.0 | MIT | low |
| `react-router-dom` | runtime | 6.30.1 | MIT | low |
| `react-syntax-highlighter` | runtime | 15.6.6 | MIT | low |
| `rehype-katex` | runtime | 7.0.1 | MIT | low |
| `rehype-raw` | runtime | 7.0.0 | MIT | low |
| `release-it` | development | 19.0.5 | MIT | low |
| `remark-gfm` | runtime | 4.0.1 | MIT | low |
| `remark-math` | runtime | 6.0.0 | MIT | low |
| `sharp` | development | 0.34.3 | Apache-2.0 | low |
| `tailwind-merge` | runtime | 3.3.1 | MIT | low |
| `tailwindcss` | development | 3.4.17 | MIT | low |
| `tsc-alias` | development | 1.8.16 | MIT | low |
| `tsx` | development | 4.21.0 | MIT | low |
| `typescript` | development | 5.9.3 | Apache-2.0 | low |
| `typescript-eslint` | development | 8.56.1 | MIT | low |
| `vite` | development | 7.1.8 | MIT | low |
| `web-push` | runtime | 3.6.7 | MPL-2.0 | high |
| `ws` | runtime | 8.18.3 | MIT | low |

