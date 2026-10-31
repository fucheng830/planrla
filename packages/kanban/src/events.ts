/**
 * @planrla/kanban 事件层 — 解耦宿主 WebSocket。
 *
 * 宿主通过 configureKanbanEvents 注入事件订阅函数;未注入时看板
 * 只靠手动/轮询刷新,不依赖任何宿主上下文。
 */

export type KanbanEvent = {
  type?: string;
  kind?: string;
  rootId?: string;
  taskId?: string;
  task?: unknown;
};

export type KanbanEventListener = (event: KanbanEvent) => void;

let hostSubscribe: ((listener: KanbanEventListener) => () => void) | null = null;

export function configureKanbanEvents(subscribe: (listener: KanbanEventListener) => () => void) {
  hostSubscribe = subscribe;
}

export function useKanbanEvents(): (listener: KanbanEventListener) => () => void {
  return (listener: KanbanEventListener) =>
    hostSubscribe ? hostSubscribe(listener) : () => {};
}
