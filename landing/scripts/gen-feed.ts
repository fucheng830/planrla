// 构建前脚本:从仓库本地发版录(docs/process/releases/*.md)生成 public/desktop/latest.json。
// 仓库为私有、GitHub Releases API 404,本地文件是唯一可靠源;读不到时用 STATIC_FALLBACK 兜底,构建不挂。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readLocalReleases, STATIC_FALLBACK } from '../src/data/releases.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED_PATH = resolve(__dirname, '../public/desktop/latest.json');

const entries = readLocalReleases();
const latest = entries[0] ?? STATIC_FALLBACK;

writeFileSync(FEED_PATH, JSON.stringify(latest, null, 2) + '\n');
console.log(`[gen-feed] wrote latest.json → ${latest.version} (${entries.length} local release notes)`);
