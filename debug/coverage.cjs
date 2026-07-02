const { DatabaseSync } = require('node:sqlite');
const path = require('path'); const fs = require('fs');
const db = new DatabaseSync(path.join(process.env.USERPROFILE||process.env.HOME,'.planrla','auth.db'), { readOnly: true });
const withJsonl = db.prepare("SELECT COUNT(*) n FROM sessions WHERE jsonl_path IS NOT NULL").get().n;
let exists=0, missing=0, empty=0, missingSamples=[];
const rows = db.prepare("SELECT jsonl_path FROM sessions WHERE jsonl_path IS NOT NULL").all();
for (const r of rows) {
  if (!fs.existsSync(r.jsonl_path)) { missing++; if(missingSamples.length<3) missingSamples.push(r.jsonl_path); }
  else exists++;
}
console.log('sessions with jsonl_path:', withJsonl);
console.log('jsonl EXISTS on disk:', exists);
console.log('jsonl MISSING on disk:', missing);
console.log('missing samples:', JSON.stringify(missingSamples));
// how many of the EXISTING jsonl have extractable message text?
let withText=0, noText=0;
for (const r of rows) {
  if (!fs.existsSync(r.jsonl_path)) continue;
  let hasText=false;
  try {
    const lines = fs.readFileSync(r.jsonl_path,'utf8').split('\n').slice(0,50); // sample first 50 lines
    for (const l of lines) { if(!l.trim())continue; const o=JSON.parse(l); const c=o.message?.content; const t = typeof c==='string'?c:(Array.isArray(c)?c.map(x=>x?.text||'').join(''):''); if(t.trim().length>=2){hasText=true;break;} }
  } catch {}
  hasText ? withText++ : noText++;
}
console.log('existing jsonl WITH text (first 50 lines):', withText);
console.log('existing jsonl NO text (first 50 lines):', noText);
db.close();
