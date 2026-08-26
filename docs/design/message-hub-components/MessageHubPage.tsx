import { useState } from 'react';
import { Toaster, toast } from 'sonner';

import { useTheme } from '../../contexts/ThemeContext';
import { MessageHubHeader } from './MessageHubHeader';
import { MessageHubInbox } from './MessageHubInbox';
import { MessageHubInspector } from './MessageHubInspector';
import { MessageHubPhonePreview } from './MessageHubPhonePreview';
import { MessageHubRail } from './MessageHubRail';
import { MessageHubThread } from './MessageHubThread';
import { messageSessions, type MessageSession } from './messageHubData';
import { MessageHubWorkflowStrip } from './MessageHubWorkflowStrip';

export function MessageHubPage() {
  const { isDarkMode } = useTheme();
  const [activeSession, setActiveSession] = useState<MessageSession>(messageSessions[0]);
  const [replies, setReplies] = useState<string[]>([]);
  const [approvalState, setApprovalState] = useState<'pending' | 'approved' | 'rejected' | 'transferred'>('pending');

  const handleSessionSelect = (session: MessageSession) => {
    setActiveSession(session);
    setReplies([]);
    setApprovalState(session.approval ? 'pending' : 'approved');
  };

  const handleSend = (message: string) => {
    setReplies((current) => [...current, message]);
    toast.success('消息已发送');
  };

  const handleApproval = (action: 'approve' | 'reject' | 'transfer') => {
    const nextState = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'transferred';
    setApprovalState(nextState);
    toast.success(action === 'approve' ? '已批准并启动 AI Agent' : action === 'reject' ? '已驳回 AI 请求' : '已转交负责人');
  };

  return (
    <main className="message-hub-page">
      <div className="message-hub-shell">
        <MessageHubHeader />
        <div className="mh-workspace-grid">
          <MessageHubRail />
          <MessageHubInbox activeSessionId={activeSession.id} onSessionSelect={handleSessionSelect} />
          <MessageHubThread activeSession={activeSession} replies={replies} approvalState={approvalState} onSend={handleSend} onApproval={handleApproval} />
          <MessageHubInspector onApprove={() => handleApproval('approve')} />
          <MessageHubWorkflowStrip />
        </div>
        <MessageHubPhonePreview />
      </div>
      <Toaster theme={isDarkMode ? 'dark' : 'light'} position="bottom-right" closeButton richColors />
    </main>
  );
}
