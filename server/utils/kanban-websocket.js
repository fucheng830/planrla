/**
 * KANBAN WEBSOCKET UTILITIES
 * ==========================
 *
 * Broadcasts kanban task state changes via WebSocket.
 */

/**
 * Broadcast a kanban task update to all connected clients.
 *
 * @param {import('ws').WebSocketServer} wss - WebSocket server (req.app.locals.wss)
 * @param {string} rootId - project root the task belongs to
 * @param {object} task - updated task object
 */
export function broadcastTaskUpdated(wss, rootId, task) {
  if (!wss || !rootId || !task) {
    console.warn('kanban WebSocket broadcast: missing wss/rootId/task');
    return;
  }

  const message = {
    type: 'kanban-task-updated',
    rootId,
    task,
    timestamp: new Date().toISOString(),
  };

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('kanban WS send error:', error);
      }
    }
  });
}

/**
 * Broadcast a kanban task deletion to all connected clients.
 *
 * @param {import('ws').WebSocketServer} wss - WebSocket server (req.app.locals.wss)
 * @param {string} rootId - project root the task belonged to
 * @param {string} taskId - deleted task id
 */
export function broadcastTaskDeleted(wss, rootId, taskId) {
  if (!wss || !rootId || !taskId) {
    console.warn('kanban WebSocket broadcast delete: missing wss/rootId/taskId');
    return;
  }

  const message = {
    type: 'kanban-task-deleted',
    rootId,
    taskId,
    timestamp: new Date().toISOString(),
  };

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('kanban WS send error:', error);
      }
    }
  });
}
