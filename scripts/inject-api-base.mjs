import { readFileSync, writeFileSync } from "node:fs";
const p = process.argv[2];
let code = readFileSync(p, "utf8");
code = code.replace("return fetch(url,", "return fetch(withBase(url),");
code = code.split("fetch(").join("apiFetch(");
const block = [
  "// ---- 宿主注入配置（@planrla/chat）：API baseURL 可由宿主改写 ----",
  "let API_BASE = '';",
  "export function configureChatApi(cfg = {}) {",
  "  API_BASE = (cfg.baseUrl || '').replace(/\\/+$/, '');",
  "}",
  "function withBase(url) {",
  "  return (API_BASE && typeof url === 'string' && url.startsWith('/')) ? API_BASE + url : url;",
  "}",
  "const apiFetch = (url, opts) => fetch(withBase(url), opts);",
  "// ---- 注入配置结束 ----",
  "",
].join("\n");
const anchor = code.indexOf("export const authenticatedFetch");
if (anchor < 0) throw new Error("anchor not found");
code = code.slice(0, anchor) + block + code.slice(anchor);
writeFileSync(p, code);
console.log("fetch(:", code.split("fetch(").length - 1, "| apiFetch(:", code.split("apiFetch(").length - 1);
