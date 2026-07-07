export type SessionReferenceMode = 'single' | 'full';

export interface ReferencedMessage {
  role: 'user' | 'assistant' | string;
  content: string;
}

export interface SessionReference {
  /** 客户端生成的唯一 id。 */
  id: string;
  sessionId: string;
  title: string;
  provider: string;
  /** ISO date string(展示用)。 */
  date: string;
  mode: SessionReferenceMode;
  messages: ReferencedMessage[];
}

export interface ParsedQuote {
  title: string;
  provider: string;
  date: string;
  /** 含 role 标注的原文块(展示时再按行渲染)。 */
  body: string;
}

/** 粗估 token:总字符数 / 4(YAGNI,不引入 tiktoken)。 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/** 把单个引用格式化为注入文本块。 */
export function formatReferenceBlock(ref: SessionReference): string {
  const header = `[引自会话「${ref.title}」(${ref.provider}, ${ref.date})]`;
  const body = ref.messages
    .map((m) => `[${m.role}] ${m.content}`.trimEnd())
    .join('\n');
  return `${header}\n\n${body}`;
}

/** 多引用按顺序拼接成完整引用区(块之间空行分隔)。 */
export function formatReferenceSection(refs: SessionReference[]): string {
  return refs.map(formatReferenceBlock).join('\n\n');
}

const QUOTE_HEADER_RE = /^\[引自会话「([^」]+)」\(([^,]+),\s*([^)]+)\)\]\n\n([\s\S]*?)\n\n---\n\n([\s\S]*)$/;

/**
 * 解析发送后的 content:若以引用块开头(单引用 common case),拆出 quote + 用户文本。
 * 多引用 / 无引用 → quote=null, text=全文(降级原样显示)。
 */
export function parseQuotedReference(content: string): { quote: ParsedQuote | null; text: string } {
  if (!content || !content.startsWith('[引自会话「')) {
    return { quote: null, text: content };
  }
  const m = content.match(QUOTE_HEADER_RE);
  if (!m) {
    return { quote: null, text: content };
  }
  const [, title, provider, date, body, text] = m;
  return { quote: { title, provider, date, body }, text };
}
