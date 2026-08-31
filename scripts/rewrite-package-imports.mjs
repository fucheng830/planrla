// 将 packages/chat/src 内的 @/ 别名 import 重写为包内相对路径
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "packages/chat/src");

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];
function resolveTarget(p) {
  for (const e of EXTS) { if (existsSync(p + e) && statSync(p + e).isFile()) return p + e; }
  for (const e of [".ts", ".tsx", ".js", ".jsx"]) {
    const idx = join(p, "index" + e);
    if (existsSync(idx)) return idx;
  }
  return null;
}

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) yield p;
  }
}

const IMPORT_RE = /(['"])(@\/[^'"]+)\1/g;
const changed = [];
const unresolved = new Map();

for (const f of walk(SRC)) {
  let code = readFileSync(f, "utf8");
  let dirty = false;
  code = code.replace(IMPORT_RE, (m, q, spec) => {
    const target = resolveTarget(join(SRC, spec.slice(2)));
    if (!target) {
      if (!unresolved.has(spec)) unresolved.set(spec, []);
      unresolved.get(spec).push(relative(SRC, f));
      return m;
    }
    let rel = relative(dirname(f), target).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    dirty = true;
    return q + rel + q;
  });
  if (dirty) { writeFileSync(f, code); changed.push(relative(SRC, f)); }
}

console.log("rewritten files:", changed.length);
console.log("unresolved specifiers:");
for (const [k, v] of unresolved) console.log(`  ${k}  <- ${v.length} files, e.g. ${v[0]}`);
