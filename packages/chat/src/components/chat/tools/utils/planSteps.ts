export interface PlanStep {
  marker: string;
  checked: boolean | null;
  text: string;
}

const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/;
const ORDERED_RE = /^\s*(\d+)\.\s+(.+)$/;

export function parsePlanSteps(content: string | undefined | null): PlanStep[] | null {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  const steps: PlanStep[] = [];
  let mode: 'checkbox' | 'ordered' | null = null;

  for (const line of lines) {
    if (steps.length === 0 && line.trim() === '') continue;

    const cb = line.match(CHECKBOX_RE);
    const od = line.match(ORDERED_RE);

    if (cb) {
      if (mode === null) mode = 'checkbox';
      if (mode !== 'checkbox') break;
      steps.push({ marker: `[${cb[1].toLowerCase()}]`, checked: cb[1].toLowerCase() === 'x', text: cb[2] });
      continue;
    }
    if (od) {
      if (mode === null) mode = 'ordered';
      if (mode !== 'ordered') break;
      steps.push({ marker: `${od[1]}.`, checked: null, text: od[2] });
      continue;
    }
    if (steps.length > 0) break;
  }

  return steps.length >= 2 ? steps : null;
}
