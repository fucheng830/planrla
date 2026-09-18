// Chat 子树依赖边界审计：为 @planrla/chat 打包做可行性评估
// 用法：node scripts/chat-package-audit.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "packages", "chat", "src");
const CHAT_ROOT = SRC;

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) yield p;
  }
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;

const files = [...walk(CHAT_ROOT)];
const buckets = new Map(); // target -> {count, files:Set}
const npm = new Map();
let defaultProps = [];
let hostApi = [];

for (const f of files) {
  const code = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  if (/\.defaultProps\s*=/.test(code)) defaultProps.push(rel);
  const hostUses = [];
  if (/window\.location/.test(code)) hostUses.push("window.location");
  if (/localStorage\./.test(code)) hostUses.push("localStorage");
  if (/navigator\./.test(code)) hostUses.push("navigator.*");
  if (hostUses.length) hostApi.push({ file: rel, uses: hostUses });
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) {
    const t = m[1] || m[2] || m[3];
    if (!t) continue;
    if (t.startsWith(".")) {
      const abs = resolve(join(f, ".."), t);
      const inChat = abs.startsWith(CHAT_ROOT);
      add(buckets, inChat ? "INTERNAL (relative)" : `RELATIVE-OUTSIDE -> ${relative(SRC, abs)}`, rel);
    } else if (t.startsWith("@/components/chat")) {
      add(buckets, "INTERNAL (@/components/chat)", rel);
    } else if (t.startsWith("@/")) {
      add(buckets, `@/ ${t.slice(2).split("/").slice(0, 2).join("/")}`, rel);
    } else {
      add(npm, t, rel);
    }
  }
}

function add(map, k, file) {
  if (!map.has(k)) map.set(k, { count: 0, files: new Set() });
  const e = map.get(k); e.count++; e.files.add(file);
}

const sort = (a, b) => b[1].count - a[1].count;

console.log("=== 文件数 ===", files.length);
console.log("\n=== 内部/边界 import 分类（按次数）===");
for (const [k, v] of [...buckets.entries()].sort(sort)) {
  console.log(`${String(v.count).padStart(4)}  ${String(v.files.size).padStart(3)} files  ${k}`);
}
console.log("\n=== npm 依赖 ===");
for (const [k, v] of [...npm.entries()].sort(sort)) {
  console.log(`${String(v.count).padStart(4)}  ${k}`);
}
console.log("\n=== React 19 风险：defaultProps ===");
console.log(defaultProps.length ? defaultProps.join("\n") : "(无)");
console.log("\n=== 宿主 API 使用（需注入配置）===");
for (const h of hostApi) console.log(`${h.file}: ${h.uses.join(", ")}`);
