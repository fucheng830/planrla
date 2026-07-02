const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db'), { readOnly: true });

const SNIP = "snippet(session_search,0,'<mark>','</mark>','…',20)";
const singlePhase = (L) => `SELECT ss.session_id, ${SNIP} h, bm25(session_search) s FROM session_search ss JOIN sessions s ON s.session_id=ss.session_id WHERE ss.content MATCH ? ORDER BY s LIMIT ${L}`;
const rankOnly = (L) => `SELECT ss.session_id FROM session_search ss JOIN sessions s ON s.session_id=ss.session_id WHERE ss.content MATCH ? ORDER BY bm25(session_search) LIMIT ${L}`;
const snipForIds = (n) => `SELECT session_id, ${SNIP} h FROM session_search WHERE content MATCH ? AND session_id IN (${Array(n).fill('?').join(',')})`;

function t(fn, r=8){ fn(); const t0=process.hrtime.bigint(); let res; for(let i=0;i<r;i++) res=fn(); return { ms: Number(process.hrtime.bigint()-t0)/1e6/r, res }; }
const Q = s => '"'+s+'"';

for (const term of ['session','typescript','性能优化','全文搜索']) {
  const q = Q(term);
  // single-phase baseline (current code shape)
  const sp = t(() => db.prepare(singlePhase(20)).all(q));
  // two-phase: rank without snippet, then snippet only the winners
  const tp = t(() => {
    const ids = db.prepare(rankOnly(20)).all(q).map(r => r.session_id);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`SELECT session_id, ${SNIP} h FROM session_search WHERE content MATCH ? AND session_id IN (${placeholders})`).all(q, ...ids);
  });
  console.log(`${term.padEnd(12)} single-phase L20: ${sp.ms.toFixed(1)}ms (${sp.res.length})  |  two-phase: ${tp.ms.toFixed(1)}ms (${tp.res.length})`);
}
db.close();
