/**
 * @planrla/chat — planrla 对话 UI 独立包入口
 *
 * 用法（宿主应用，如万象）：
 *   import { ChatInterface, WebSocketProvider, configureChatApi, initChatI18n } from "@planrla/chat";
 *   await initChatI18n();
 *   configureChatApi({ baseUrl: "http://localhost:3201" });
 *   <WebSocketProvider config={{ wsUrl: "ws://localhost:3201/ws", token }}>
 *     <ChatInterface ... />
 *   </WebSocketProvider>
 */

export { default as ChatInterface } from './components/chat/view/ChatInterface';
export { default as ChatSession } from './components/chat/view/ChatSession';
export type { ChatSessionProps } from './components/chat/view/ChatSession';
export { default as ChatMessagesPane } from './components/chat/view/subcomponents/ChatMessagesPane';
export type { ChatMessagesPaneProps } from './components/chat/view/subcomponents/ChatMessagesPane';
export { default as ChatComposer } from './components/chat/view/subcomponents/ChatComposer';
export type { ChatComposerProps } from './components/chat/view/subcomponents/ChatComposer';
export { default as MessageComponent } from './components/chat/view/subcomponents/MessageComponent';
export type { MessageComponentProps } from './components/chat/view/subcomponents/MessageComponent';
export { default as PermissionRequestsBanner } from './components/chat/view/subcomponents/PermissionRequestsBanner';
export type { PermissionRequestsBannerProps } from './components/chat/view/subcomponents/PermissionRequestsBanner';
export { WebSocketProvider, ChatWsConfigProvider } from './contexts/WebSocketContext';
export { useWebSocket } from './contexts/WebSocketContext';
export type { ChatWsConfig } from './contexts/WebSocketContext';
export type { ServerEvent } from './contexts/WebSocketContext';
export { configureChatApi } from './utils/api';
export { default as i18n } from 'i18next';
export { default as SessionReferencePicker } from './components/chat/view/subcomponents/SessionReferencePicker';
export type { PickerCandidateSession } from './components/chat/view/subcomponents/SessionReferencePicker';
export { toCandidateSession } from './components/chat/utils/candidateSession';
export { Markdown } from './components/chat/view/subcomponents/Markdown';
export type { PermissionMode, PendingPermissionRequest, ChatMessage } from './components/chat/types/types';
export type { SessionEstablishedContext, SessionNavigationOptions } from './components/chat/types/types';
export { useSessionProtection } from './hooks/useSessionProtection';
export type {
  SessionActivity,
  SessionActivityMap,
  MarkSessionProcessing,
  MarkSessionIdle,
  MarkSessionCompleted,
} from './hooks/useSessionProtection';

let i18nReady = false;
/** 幂等初始化 i18next（语言包内置）。宿主在渲染对话 UI 前调用一次。 */
export async function initChatI18n(): Promise<void> {
  if (i18nReady) return;
  await import('./i18n/config.js');
  i18nReady = true;
}
