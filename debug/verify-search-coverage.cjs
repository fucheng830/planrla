// Follow-up: characterize latency across term frequencies + explain 2920/4462 coverage.
// Run: node --experimental-sqlite debug/verify-search-coverage.cjs
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

function time(sql, q, runs = 8) {
  try { db.prepare(sql).all(q); } catch (e) { return { err: e.message }; } // warm
  const t0 = process.hrtime.bigint();
  let r;
  for (let i = 0; i < runs; i++) r = db.prepare(sql).all(q);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  return { ms, hits: r ? r.length : 0 };
}

const SQL = (lim) => `SELECT ss.session_id, snippet(session_search,0,'<mark>','</mark>','…',20) AS h, bm25(session_search) AS s
               FROM session_search ss JOIN sessions s ON s.session_id=ss.session_id
               WHERE ss.content MATCH ? ORDER BY s LIMIT ${lim}`;

console.log('\n=== LATENCY BY TERM FREQUENCY (LIMIT 50) ===');
for (const term of ['session', 'error', 'typescript', 'docker', 'auth', 'grep', 'unicode', 'jsonl']) {
  const r = time(SQL(50), `"${term}"`);
  if (r.err) { console.log(`  "${term}" -> ERROR ${r.err}`); continue; }
  console.log(`  "${term}" -> ${r.ms.toFixed(1)}ms, hits=${r.hits}`);
}

console.log('\n=== "session" WITH SMALLER LIMIT (does snippet cost scale with hits?) ===');
for (const lim of [5, 10, 20, 50]) {
  const r = time(SQL(lim), `"session"`);
  console.log(`  LIMIT ${lim} -> ${r.ms.toFixed(1)}ms, hits=${r.hits}`);
}

console.log('\n=== A FEW REAL CJK TOPICS (the stated criterion: 3+ char Chinese) ===');
for (const term of ['性能优化', '美股聪明钱', '内幕交易', '全文搜索', '数据库', '索引']) {
  const r = time(SQL(50), `"${term}"`);
  if (r.err) { console.log(`  "${term}" -> ERROR ${r.err}`); continue; }
  console.log(`  "${term}" -> ${r.ms.toFixed(2)}ms, hits=${r.hits}`);
}

console.log('\n=== INDEX COVERAGE: why 2920/4462? ===');
const withJsonl = db.prepare("SELECT COUNT(*) n FROM sessions WHERE jsonl_path IS NOT NULL").get().n;
console.log('  sessions with jsonl_path: ' + withJsonl);
// Check how many of those jsonl files actually exist on disk
let exists = 0, missing = 0, missingSamples = [];
for (const r of db.prepare("SELECT jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL").all()) {
  if (fs.existsSync(r.jsonl_path)) exists++; else { missing++; if (missingSamples.length < 3) missingSamples.push(r.jsonl_path); }
}
console.log(`  jsonl exists on disk: ${exists}`);
console.log(`  jsonl MISSING on disk: ${missing}`);
console.log(`  missing samples: ${JSON.stringify(missingSamples)}`);

db.close();
console.log('\nDONE');
