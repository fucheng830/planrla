// 删除前最终检查：src 内（排除 chat 子树自身）是否还有 import 指向 components/chat
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const CHAT = join(SRC, "components", "chat");
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx"];
function resolveTarget(p) {
  for (const e of EXTS) if (existsSync(p + e) && statSync(p + e).isFile()) return p + e;
  for (const e of [".ts", ".tsx", ".js", ".jsx", ".json"]) if (existsSync(join(p, "index" + e))) return join(p, "index" + e);
  return null;
}
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e); const st = statSync(p);
    if (st.isDirectory()) { if (!p.startsWith(CHAT)) yield* walk(p); }
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) yield p;
  }
}
const RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
let hits = 0;
for (const f of walk(SRC)) {
  const code = readFileSync(f, "utf8"); let m; RE.lastIndex = 0;
  while ((m = RE.exec(code))) {
    const t = m[1] || m[2]; if (!t || !t.startsWith(".")) continue;
    const abs = resolveTarget(resolve(dirname(f), t));
    if (abs && abs.startsWith(CHAT)) { console.log(relative(SRC, f), "->", t); hits++; }
  }
}
console.log(hits === 0 ? "CLEAN: 无残留引用，可安全删除" : `残留 ${hits} 处`);
