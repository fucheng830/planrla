/**
 * The chat package owns the websocket implementation so host views and the
 * embedded ChatInterface always consume the same React context instance.
 *
 * In OSS mode the shell supplies the auth token here. External hosts instead
 * mount the package's WebSocketProvider with an explicit wsUrl/token config.
 */
import type { ReactNode } from 'react';
import {
  WebSocketProvider as ChatWebSocketProvider,
  type ChatWsConfig,
} from '@planrla/chat';

import { useAuth } from '../components/auth/context/AuthContext';

export { useWebSocket, type ServerEvent } from '@planrla/chat';

type WebSocketProviderProps = {
  children: ReactNode;
};

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { token } = useAuth();
  const config: ChatWsConfig = { token };

  return (
    <ChatWebSocketProvider config={config}>
      {children}
    </ChatWebSocketProvider>
  );
}
