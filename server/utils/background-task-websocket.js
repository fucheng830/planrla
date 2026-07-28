// server/utils/background-task-websocket.js
//
// REQ-046 — 广播后台任务变更到所有 WS 客户端。
// 镜像 server/utils/kanban-websocket.js 模式(event 用 `type` 字段)。
//
// 事件:
// - background-task-updated { type, task }       upsert
// - background-task-deleted { type, taskId }     remove / TTL 清理

/**
 * 广播一条后台任务变更(upsert 或删除)。
 * @param {import('ws').WebSocketServer} wss
 * @param {object|null} task    task 对象 = upsert;null = 删除
 * @param {string} taskId
 */
export function broadcastBackgroundTaskChanged(wss, task, taskId) {
  if (!wss || !taskId) return;
  const message = task
    ? { type: 'background-task-updated', task, timestamp: new Date().toISOString() }
    : { type: 'background-task-deleted', taskId, timestamp: new Date().toISOString() };
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('background-task WS send error:', error);
      }
    }
  });
}
