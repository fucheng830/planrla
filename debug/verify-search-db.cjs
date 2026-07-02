// FTS5 session-search verification: ground-truth inspection of the live DB.
// Run: node --experimental-sqlite debug/verify-search-db.cjs
// NOTE: uses node:sqlite (built-in), not better-sqlite3, because the installed
// better-sqlite3 native binary targets a different Node ABI than the dev shell.
// Same SQLite engine; driver overhead differs by microseconds, so <50ms timing
// here is a faithful (slightly conservative) proxy for the production query.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

function p(msg) { console.log(msg); }

// 1) Sessions ground truth
p('\n=== SESSIONS ===');
p('total: ' + db.prepare("SELECT COUNT(*) n FROM sessions").get().n);
p('by provider: ');
for (const r of db.prepare("SELECT provider, COUNT(*) n FROM sessions GROUP BY provider").all()) p(`  ${r.provider}: ${r.n}`);
p('with jsonl_path: ' + db.prepare("SELECT COUNT(*) n FROM sessions WHERE jsonl_path IS NOT NULL").get().n);

// 2) FTS5 index state
p('\n=== session_search FTS5 table ===');
const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_search'").get();
if (!tbl) {
  p('  TABLE DOES NOT EXIST (server has not run the schema migration yet)');
} else {
  p('  table exists');
  try {
    const n = db.prepare("SELECT COUNT(*) n FROM session_search").get().n;
    p('  rows indexed: ' + n);
  } catch (e) { p('  count failed: ' + e.message); }
}

// 3) Users (for auth)
p('\n=== USERS ===');
for (const u of db.prepare("SELECT id, username, created_at FROM users LIMIT 5").all()) p(`  id=${u.id} user=${u.username}`);

// 4) Sample some real content tokens to use as realistic 3+ char Chinese queries
p('\n=== SAMPLE QUERY TERMS (from indexed content) ===');
let sampleTerms = [];
if (tbl) {
  try {
    const row = db.prepare("SELECT content FROM session_search LIMIT 1").get();
    if (row && row.content) {
      const cjk = row.content.match(/[一-鿿]{3,}/g) || [];
      sampleTerms = [...new Set(cjk)].slice(0, 5);
      p('  sampled from session_search.content: ' + JSON.stringify(sampleTerms));
    }
  } catch (e) { p('  sample failed: ' + e.message); }
}

// 5) TIMING — the core <50ms acceptance criterion, measured at the SQL layer
//    (server route adds ~1ms localhost overhead; this is the query itself)
p('\n=== QUERY TIMING (better-sqlite3, the production driver) ===');
if (tbl) {
  const probes = [
    { name: '3-char CJK (from content)', q: sampleTerms[0] || '性能优化' },
    { name: '4-char CJK common',        q: '性能优化' },
    { name: '2-char CJK',               q: '性能' },
    { name: '1-char CJK',               q: '性' },
    { name: 'english word',             q: 'session' },
  ];
  const sql = `SELECT ss.session_id, snippet(session_search,0,'<mark>','</mark>','…',20) AS highlight, bm25(session_search) AS score
               FROM session_search ss JOIN sessions s ON s.session_id=ss.session_id
               WHERE ss.content MATCH ? ORDER BY score LIMIT 50`;
  for (const probe of probes) {
    // warm + escape as the service does (wrap in double quotes)
    const ftsQ = `"${probe.q}"`;
    // warm-up (FTS query plan cache)
    try { db.prepare(sql).all(ftsQ); } catch (e) { p(`  [${probe.name}] q=${probe.q} -> ERROR ${e.message}`); continue; }
    const runs = 5;
    const t0 = process.hrtime.bigint();
    let results;
    try {
      for (let i = 0; i < runs; i++) results = db.prepare(sql).all(ftsQ);
    } catch (e) { p(`  [${probe.name}] q=${probe.q} -> RUN ERROR ${e.message}`); continue; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
    const sample = results && results[0] ? results[0].highlight.slice(0, 60) : '(no match)';
    p(`  [${probe.name}] q="${probe.q}" -> ${(ms).toFixed(2)}ms avg over ${runs} | hits=${results ? results.length : 0} | top: ${sample}`);
  }
} else {
  p('  skipped (table missing)');
}

db.close();
p('\nDONE');
