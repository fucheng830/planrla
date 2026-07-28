// src/components/background-tasks/types.ts
//
// REQ-046 — 前端 BackgroundTask 模型(wire-compatible 重声明,见 server/modules/background-tasks/types.ts)。
// 前端 tsconfig 不含 server/,不能 import,字段名严格对齐 JSON。

export type BackgroundTaskType = 'kanban' | 'a2a' | 'chat' | 'bash';
export type BackgroundTaskStatus =
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed';

export type BackgroundTaskDetail =
  | {
      type: 'kanban';
      taskId: string;
      rootId: string;
      title: string;
      stage?: number;
      stageTotal?: number;
      aux: {
        askUserWaiting: boolean;
        hasPlan: boolean;
        hasTodos: boolean;
        hasTask: boolean;
        sessionError?: string;
      };
    }
  | {
      type: 'a2a';
      taskId: string;
      state: 'working' | 'completed' | 'failed' | 'canceled';
      provider?: string;
      text: string;
      spawnedAppSessionId?: string;
    }
  | { type: 'chat'; appSessionId: string; provider?: string }
  | {
      type: 'bash';
      appSessionId: string;
      bashTaskId: string;
      cmd: string;
      outputTail: string[];
      exitCode?: number;
      forceMarked?: boolean;
    };

export interface BackgroundTask {
  id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  title: string;
  progress?: number;
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
  subtitle?: string;
  error?: string;
  detail: BackgroundTaskDetail;
}
