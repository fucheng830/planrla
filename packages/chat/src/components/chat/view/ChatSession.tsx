import type { ChatInterfaceProps } from '../types/types';
import ChatInterface from './ChatInterface';

/**
 * A stable session-level building block for host applications.
 *
 * The host still owns project/session navigation and transport, while this
 * component owns the complete message + composer surface.
 */
export interface ChatSessionProps extends ChatInterfaceProps {
  className?: string;
}

export default function ChatSession({ className = 'h-full', ...props }: ChatSessionProps) {
  return (
    <div className={className} data-chat-session="true">
      <ChatInterface {...props} />
    </div>
  );
}
