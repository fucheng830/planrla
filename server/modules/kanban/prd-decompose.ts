import type { TaskPriority } from '@/modules/kanban/types.js';
import { isTaskPriority } from '@/modules/kanban/types.js';
import { AppError } from '@/shared/utils.js';

/** One decomposed task as produced by the PRD decomposition prompt. */
export interface DecomposedTask {
  title: string;
  input: string;
  priority: TaskPriority;
  /** Indices of earlier items in the same array that must finish first. */
  dependsOn: number[];
}

const MAX_PRD_LENGTH = 20_000;
const MAX_TASKS = 12;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

const buildPrompt = (prd: string): string => `You are decomposing a product requirements document into executable tasks for a kanban board.

Output ONLY a JSON array — no markdown fences, no commentary, no trailing text. Each array item must have exactly these fields:
{
  "title": string,          // short task title (one line)
  "input": string,          // the concrete, self-contained instruction the executing agent will receive. The agent sees ONLY this text, not the PRD, so include everything it needs.
  "priority": "high" | "medium" | "low",
  "dependsOn": number[]     // 0-based indices of earlier items that must complete first; [] when independent
}

Rules:
- Produce 3-8 tasks, ordered so every dependency appears before its dependents.
- Keep "input" actionable and self-contained.
- Do not nest tasks; this is a flat list.

PRD:
"""
${prd}
"""`;

type SpawnFn = (command: string, options: Record<string, unknown>, writer: unknown) => Promise<unknown>;

/**
 * Collects streamed assistant text from any provider spawnFn writer stream.
 * Provider wrappers emit normalized messages ({ kind: 'stream_delta', content })
 * either as objects or JSON strings; anything else (tool calls, status lines)
 * is ignored for decomposition purposes.
 */
function createTextCollector() {
  let text = '';
  let errorText = '';

  const handle = (msg: any): void => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'stream_delta' && typeof msg.content === 'string') {
      text += msg.content;
    } else if (msg.kind === 'error' && typeof msg.content === 'string') {
      errorText += `${msg.content}\n`;
    }
  };

  const writer = {
    userId: null,
    send: (msg: unknown) => {
      if (typeof msg === 'string') {
        try {
          handle(JSON.parse(msg));
        } catch {
          // Non-JSON line: treat as raw assistant text.
          text += msg;
        }
        return;
      }
      handle(msg);
    },
    setSessionId: () => {},
  };

  return {
    writer,
    getText: () => text,
    getError: () => errorText.trim(),
  };
}

/** Extracts the first balanced [...] block from free-form model output. */
function extractJsonArray(raw: string): unknown[] {
  const start = raw.indexOf('[');
  if (start === -1) {
    throw new AppError('decomposition output contained no JSON array', { code: 'PRD_PARSE_FAILED', statusCode: 502 });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(start, i + 1));
          if (Array.isArray(parsed)) return parsed;
          break;
        } catch {
          break;
        }
      }
    }
  }

  throw new AppError('decomposition output was not valid JSON', { code: 'PRD_PARSE_FAILED', statusCode: 502 });
}

function normalizeItem(raw: unknown, index: number): DecomposedTask {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : `Task ${index + 1}`;
  const input = typeof record.input === 'string' && record.input.trim() ? record.input.trim() : title;
  const priority = isTaskPriority(record.priority) ? record.priority : 'medium';
  const dependsOn = Array.isArray(record.dependsOn)
    ? [...new Set(record.dependsOn.filter((v): v is number => Number.isInteger(v) && v >= 0 && v < index))]
    : [];

  return { title, input, priority, dependsOn };
}

/**
 * Decomposes a PRD into kanban task drafts using one of the provider runtimes.
 * The spawn function is injectable so tests can stub the model call.
 */
export async function decomposePrd(options: {
  prd: string;
  provider: string;
  cwd?: string;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}): Promise<DecomposedTask[]> {
  const prd = options.prd.trim();
  if (!prd) {
    throw new AppError('prd is required', { code: 'PRD_REQUIRED', statusCode: 400 });
  }
  const trimmedPrd = prd.length > MAX_PRD_LENGTH ? `${prd.slice(0, MAX_PRD_LENGTH)}\n…(truncated)` : prd;

  let spawnFn = options.spawnFn;
  if (!spawnFn) {
    // Lazy import keeps the module loadable in tests that never hit a provider.
    const { spawnFns } = await import('@/modules/providers/index.js');
    spawnFn = spawnFns[options.provider];
  }
  if (!spawnFn) {
    throw new AppError(`unknown provider: ${options.provider}`, { code: 'UNSUPPORTED_PROVIDER', statusCode: 400 });
  }

  const collector = createTextCollector();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      spawnFn(buildPrompt(trimmedPrd), { cwd: options.cwd ?? process.cwd() }, collector.writer),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('PRD decomposition timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const rawArray = extractJsonArray(collector.getText());
  if (rawArray.length === 0) {
    throw new AppError('decomposition produced an empty task list', { code: 'PRD_PARSE_FAILED', statusCode: 502 });
  }

  return rawArray.slice(0, MAX_TASKS).map((item, index) => normalizeItem(item, index));
}
