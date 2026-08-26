import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';

import { cn } from '../../lib/utils';
import { MessageHubInbox } from './MessageHubInbox';
import { MessageHubInspector } from './MessageHubInspector';
import { MessageHubThread, type ApprovalState } from './MessageHubThread';
import { messageSessions, type MessageSession } from './messageHubData';

type MessageHubPageProps = {
  /** Live sessions; defaults to the bundled design sample data. */
  sessions?: MessageSession[];
  userName?: string;
  /** embedded (default): fills the workbench area — the app shell provides
   *  the outer chrome and navigation sidebar. standalone keeps the padded
   *  demo framing for routes of its own. */
  variant?: 'embedded' | 'standalone';
  loadingHint?: string | null;
  errorHint?: string | null;
  /** Real approval backend (e.g. kanban task actions). Throwing keeps the
   *  approval card pending; without a handler the action stays local. */
  onApprovalAction?: (session: MessageSession, action: 'approve' | 'reject' | 'transfer') => Promise<void>;
  /** Real send backend (e.g. team messages). Receives undefined when the
   *  composer is used with no session selected (new team message). Return
   *  true when handled — the local reply append is skipped so the server
   *  round-trip owns the thread. */
  onSendMessage?: (session: MessageSession | undefined, message: string) => Promise<boolean>;
  /** Lazily load extra thread content (e.g. the kanban task's execution
   *  timeline) when a session becomes active. Cached per session id. */
  loadSessionDetail?: (session: MessageSession) => Promise<{ bodyAppend?: string } | undefined>;
};

export function MessageHubPage({
  sessions = messageSessions,
  userName = '我',
  variant = 'embedded',
  loadingHint,
  errorHint,
  onApprovalAction,
  onSendMessage,
  loadSessionDetail,
}: MessageHubPageProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [repliesBySession, setRepliesBySession] = useState<Record<string, string[]>>({});
  const [approvalBySession, setApprovalBySession] = useState<Record<string, ApprovalState>>({});
  const [detailBySession, setDetailBySession] = useState<Record<string, string | undefined>>({});

  // Sessions arrive asynchronously (live sources); drop a stale selection.
  useEffect(() => {
    if (sessions.length === 0) return;
    if (!sessions.some((session) => session.id === activeId)) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? sessions[0],
    [activeId, sessions],
  );

  const approvalState: ApprovalState = (activeSession && approvalBySession[activeSession.id]) ?? (activeSession?.approval ? 'pending' : 'approved');
  const replies = (activeSession && repliesBySession[activeSession.id]) ?? [];

  // Lazily fetch thread detail (execution timeline) once per session.
  // `id in detailBySession` marks loaded; '' means loaded-with-nothing.
  useEffect(() => {
    if (!loadSessionDetail || !activeSession) return;
    if (activeSession.id in detailBySession) return;
    let cancelled = false;
    void loadSessionDetail(activeSession)
      .then((detail) => {
        if (!cancelled) setDetailBySession((current) => ({ ...current, [activeSession.id]: detail?.bodyAppend ?? '' }));
      })
      .catch(() => {
        if (!cancelled) setDetailBySession((current) => ({ ...current, [activeSession.id]: '' }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, loadSessionDetail]);

  const handleSend = (message: string) => {
    void (async () => {
      try {
        if (onSendMessage && (await onSendMessage(activeSession, message))) return;
        if (!activeSession) return;
        setRepliesBySession((current) => ({ ...current, [activeSession.id]: [...(current[activeSession.id] ?? []), message] }));
        toast.success('消息已发送');
      } catch (e) {
        toast.error(`发送失败:${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  const handleApproval = (action: 'approve' | 'reject' | 'transfer') => {
    if (!activeSession) return;
    void (async () => {
      try {
        if (onApprovalAction) {
          await onApprovalAction(activeSession, action);
        } else {
          toast.success(action === 'approve' ? '已批准并启动 AI Agent' : action === 'reject' ? '已驳回 AI 请求' : '已转交负责人');
        }
        const nextState: ApprovalState = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'transferred';
        setApprovalBySession((current) => ({ ...current, [activeSession.id]: nextState }));
      } catch (e) {
        toast.error(`操作失败:${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  return (
    <main className={cn('message-hub-page', variant === 'embedded' && 'mh-embedded')}>
      <div className="message-hub-shell">
        {(loadingHint || errorHint) && (
          <p role={errorHint ? 'alert' : 'status'} className={cn('mh-status-bar', errorHint && 'is-error')}>
            {errorHint ?? loadingHint}
          </p>
        )}
        <div className="mh-workspace-grid">
          <MessageHubInbox sessions={sessions} activeSessionId={activeSession?.id} onSessionSelect={(session) => setActiveId(session.id)} />
          <MessageHubThread
            activeSession={activeSession}
            replies={replies}
            approvalState={approvalState}
            userName={userName}
            detailBody={activeSession ? detailBySession[activeSession.id] : undefined}
            onSend={handleSend}
            onApproval={handleApproval}
          />
          <MessageHubInspector session={activeSession} onApprove={() => handleApproval('approve')} />
        </div>
      </div>
      <Toaster theme="system" position="bottom-right" closeButton richColors />
    </main>
  );
}
