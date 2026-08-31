// 校验 packages/chat/src 自包含性：所有 import 必须解析到包内
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "packages/chat/src");
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];
function resolveTarget(p) {
  for (const e of EXTS) { if (existsSync(p + e) && statSync(p + e).isFile()) return p + e; }
  // TS 风格：import "./x.js" 实际指向 x.ts/x.tsx
  if (/\.js$/.test(p)) {
    for (const e of [".ts", ".tsx"]) { if (existsSync(p.slice(0, -3) + e)) return p.slice(0, -3) + e; }
  }
  for (const e of [".ts", ".tsx", ".js", ".jsx"]) { const i = join(p, "index" + e); if (existsSync(i)) return i; }
  return null;
}
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) yield p;
  }
}
const RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
const outside = new Map();
const bare = new Map();
for (const f of walk(SRC)) {
  const code = readFileSync(f, "utf8"); const rel = relative(SRC, f);
  let m; RE.lastIndex = 0;
  while ((m = RE.exec(code))) {
    const t = m[1] || m[2] || m[3]; if (!t) continue;
    if (t.startsWith(".")) {
      const abs = resolveTarget(resolve(dirname(f), t));
      if (!abs || !abs.startsWith(SRC)) {
        const k = t; if (!outside.has(k)) outside.set(k, []);
        outside.get(k).push(rel);
      }
    } else if (!t.startsWith("node:")) {
      if (!bare.has(t)) bare.set(t, 0); bare.set(t, bare.get(t) + 1);
    }
  }
}
console.log("=== 逃逸包外的相对 import ===");
if (!outside.size) console.log("(无 - 完全自包含)");
for (const [k, v] of outside) console.log(`  ${k}  <- ${v.length} files, e.g. ${v[0]}`);
console.log("\n=== bare specifiers（npm，应为 peer/dep）===");
for (const [k, c] of [...bare.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(c).padStart(3)}  ${k}`);
