/**
 * 把用户 query 包成 FTS5 短语查询（双引号转义为""）。
 * trigram tokenizer 下短语查询命中 3+ 字符序列。
 *
 * 纯函数模块：不 import db，方便 tsx 单测（避开 @/ alias 解析问题）。
 */
export function escapeFtsQuery(q: string): string {
  return '"' + (q ?? '').replace(/"/g, '""') + '"';
}
