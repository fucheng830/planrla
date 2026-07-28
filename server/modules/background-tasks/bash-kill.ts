// server/modules/background-tasks/bash-kill.ts
//
// REQ-046 §13 ③ — bash kill 调度器(方案 C 精简版)。
//
// SDK pid 探测结论:SDK 不透 OS pid,但提供 `queryInstance.stopTask(taskId)`。
// claude-sdk.js 的 sessionManager(`addSession`/`getSession`)已存 queryInstance 句柄。
// 本模块:把 (appSessionId, bashTaskId) → 调 SDK stopTask,返回结果给 registry。
//
// 与 claude-sdk.js 解耦:不直接 import claude-sdk.js(避免循环依赖 + 让
// registry.service 可独立单测)。通过 deps 注入 stopTask 函数 + getSessionRef。

export interface BashKillDeps {
  /**
   * 按 appSessionId 拿到 SDK queryInstance(或一个带 stopTask 方法的对象)。
   * claude-sdk.js 注入:() => getSession(appSessionId)?.instance。
   * 返回 undefined = session 已结束/不存在。
   */
  resolveQueryInstance: (appSessionId: string) =>
    | { stopTask: (taskId: string) => Promise<void> }
    | undefined;
}

let deps: BashKillDeps | null = null;

export function setBashKillDeps(next: BashKillDeps): void {
  deps = next;
}

/**
 * 调 SDK stopTask 杀 background bash。方案 C 精简版(不扫进程、不 abort run)。
 * @returns { killed: true } 成功;{ killed: false, error } 无法 kill(session 不在等)
 */
export async function killBashTask(
  appSessionId: string,
  bashTaskId: string,
): Promise<{ killed: boolean; error?: string }> {
  if (!deps) {
    return { killed: false, error: 'bash-kill deps not configured' };
  }
  const instance = deps.resolveQueryInstance(appSessionId);
  if (!instance || typeof instance.stopTask !== 'function') {
    return { killed: false, error: 'session not active (no queryInstance)' };
  }
  try {
    await instance.stopTask(bashTaskId);
    return { killed: true };
  } catch (err) {
    return { killed: false, error: (err as Error)?.message ?? 'stopTask threw' };
  }
}
