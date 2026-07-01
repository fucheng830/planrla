import fs from 'node:fs';
import readline from 'node:readline';

/**
 * 从 session jsonl 提取所有消息文本，拼接成 "role: content" 多行。
 * 跳过非消息行（last-prompt 等 meta）、空行、坏行、无 content 的行。
 * content 可能是 string 或 [{type:'text', text:'...'}]，两者都处理。
 */
export async function extractSessionText(jsonlPath: string): Promise<string> {
  if (!fs.existsSync(jsonlPath)) return '';
  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const parts: string[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try { row = JSON.parse(trimmed); } catch { continue; }
    const msg = row?.message;
    if (!msg?.content) continue;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text ?? '').join(' ')
        : '';
    if (text.trim()) parts.push(`${msg.role ?? 'user'}: ${text}`);
  }
  return parts.join('\n');
}
