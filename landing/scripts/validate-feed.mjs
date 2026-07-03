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
