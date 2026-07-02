// Verify Fix 2: run the EXACT production SQL (N+1 vs batched) against the live DB.
// Proves correctness (same first-page + totals) + timing (N+1 → 1 query).
// Run: node --experimental-sqlite debug/verify-batched-sql.cjs
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db'), { readOnly: true });
const COLS = 'session_id, provider, provider_session_id, project_path, jsonl_path, custom_name, isArchived, created_at, updated_at';
const LIMIT = 20, OFFSET = 0;

const paths = db.prepare("SELECT project_path FROM projects").all().map(r => r.project_path);
console.log(`projects: ${paths.length}`);

// --- OLD: N+1 (per-project page + count) ---
function oldWay() {
  const t0 = process.hrtime.bigint();
  const result = new Map();
  for (const p of paths) {
    const rows = db.prepare(
      `SELECT ${COLS} FROM sessions WHERE project_path = ? AND isArchived = 0 ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC LIMIT ? OFFSET ?`
    ).all(p, LIMIT, OFFSET);
    const total = db.prepare(`SELECT COUNT(*) c FROM sessions WHERE project_path = ? AND isArchived = 0`).get(p).c;
    result.set(p, { ids: rows.map(r => r.session_id), total });
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, result };
}

// --- NEW: batched window-function SQL (mirrors getSessionsByProjectPathsFirstPage) ---
function newWay() {
  const t0 = process.hrtime.bigint();
  const placeholders = paths.map(() => '?').join(',');
  const rows = db.prepare(
    `WITH ranked AS (
       SELECT ${COLS},
              ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC) AS rn,
              COUNT(*) OVER (PARTITION BY project_path) AS total
       FROM sessions WHERE project_path IN (${placeholders}) AND isArchived = 0
     )
     SELECT * FROM ranked WHERE rn > ? AND rn <= ?`
  ).all(...paths, OFFSET, OFFSET + LIMIT);
  const result = new Map();
  for (const p of paths) result.set(p, { ids: [], total: 0 });
  for (const r of [...rows].sort((a, b) => a.rn - b.rn)) {
    const e = result.get(r.project_path);
    e.ids.push(r.session_id);
    e.total = r.total;
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, result, rowCount: rows.length };
}

// warm
oldWay(); newWay();
const o = oldWay();
const n = newWay();
console.log(`\nOLD (N+1, ${paths.length * 2} queries): ${o.ms.toFixed(1)}ms`);
console.log(`NEW (1 batched query, ${n.rowCount} rows): ${n.ms.toFixed(1)}ms`);
console.log(`speedup: ${(o.ms / n.ms).toFixed(1)}×`);

// correctness: compare per-project ids + totals
let mismatches = 0;
for (const p of paths) {
  const a = o.result.get(p), b = n.result.get(p);
  if (a.total !== b.total) { mismatches++; console.log(`  TOTAL MISMATCH ${p}: old=${a.total} new=${b.total}`); }
  if (a.ids.join(',') !== b.ids.join(',')) { mismatches++; console.log(`  IDS MISMATCH ${p}: old=${a.ids.length} new=${b.ids.length}`); }
}
console.log(mismatches === 0 ? `\n✓ correctness: all ${paths.length} projects match (first-page ids + totals)` : `\n✗ ${mismatches} mismatches`);

// show the big project
const big = [...paths].sort((a, b) => n.result.get(b).total - n.result.get(a).total)[0];
console.log(`\nbiggest project: total=${n.result.get(big).total}, first-page ids=${n.result.get(big).ids.length} (limit ${LIMIT})`);
db.close();
