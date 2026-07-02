// 构建前脚本：fetch GitHub Releases，把最新版写入 public/desktop/latest.json。
// fetch 失败时用 STATIC_FALLBACK 覆盖（内容与 git 兜底一致），构建不挂。
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
