import type { LLMProvider } from '../../types/app';

/**
 * 三级读取链：
 *   1. <provider>-model（上次选择，记 session 切换）
 *   2. <provider>-default-model（用户在设置页配置的默认）
 *   3. fallback（调用方传入的硬编码 FALLBACK_DEFAULT_MODEL[provider]）
 */
export function resolveInitialModel(provider: LLMProvider, fallback: string): string {
  try {
    const last = localStorage.getItem(`${provider}-model`);
    if (last) return last;
    const configured = localStorage.getItem(`${provider}-default-model`);
    if (configured) return configured;
  } catch {
    /* localStorage 不可用（隐私模式等）→ 走 fallback */
  }
  return fallback;
}

/** 设置某 provider 的默认模型（设置页调用）。 */
export function setDefaultModel(provider: LLMProvider, model: string): void {
  localStorage.setItem(`${provider}-default-model`, model);
}

/** 读某 provider 的默认模型（设置页回显）。 */
export function getDefaultModel(provider: LLMProvider): string | null {
  try {
    return localStorage.getItem(`${provider}-default-model`);
  } catch {
    return null;
  }
}
