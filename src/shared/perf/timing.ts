/**
 * 性能测量 wrapper。dev 模式 console.debug 耗时；生产零开销（直接调 fn）。
 * 用法：`const r = measure('session-switch', () => compute())`
 *      `const r = await measureAsync('first-token', async () => await fetch())`
 */

// 模块级 dev 开关：默认从 import.meta.env（Vite）检测；__setDevMode 供测试注入。
// 项目 tsconfig 已 types:["vite/client"]，import.meta.env.DEV 类型安全。
let devMode = !!import.meta.env.DEV;

/** @internal 测试 hook —— 注入 dev/prod 模式。生产代码勿调。 */
export function __setDevMode(v: boolean): void {
  devMode = v;
}

/** 同步：performance.now 包 fn + dev console.debug 耗时。生产直接调 fn（零开销）。 */
export function measure<T>(name: string, fn: () => T): T {
  if (!devMode) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}

/** 异步版。 */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!devMode) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.debug(`[perf] ${name} took ${Math.round(performance.now() - t0)}ms`);
  }
}
