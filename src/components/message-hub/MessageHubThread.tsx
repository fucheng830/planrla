import { AtSign, Bot, CheckCircle2, Ellipsis, FileText, Paperclip, Plus, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { cn } from '../../lib/utils';
import type { MessageSession } from './messageHubData';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'transferred';

type MessageHubThreadProps = {
  activeSession: MessageSession | undefined;
  replies: string[];
  approvalState: ApprovalState;
  userName: string;
  onSend: (message: string) => void;
  onApproval: (action: 'approve' | 'reject' | 'transfer') => void;
};

export function MessageHubThread({ activeSession, replies, approvalState, userName, onSend, onApproval }: MessageHubThreadProps) {
  const [draft, setDraft] = useState('');
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    onSend(message);
    setDraft('');
  };

  const composer = (
    <form className="mh-composer" aria-label="回复消息" onSubmit={handleSubmit}><textarea aria-label="回复消息" placeholder={activeSession ? '回复消息...' : '发送团队消息...'} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="mh-composer-toolbar"><div><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加表情"><span>☺</span></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加附件"><Paperclip /></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="提及成员"><AtSign /></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加上下文"><Plus /></button></div><button type="submit" className="mh-send-button">发送 <Send /></button></div></form>
  );

  if (!activeSession) {
    return (
      <section className="mh-thread" aria-label="消息线程">
        <div className="mh-thread-content"><div className="mh-empty-inspector"><Bot /><strong>没有选中的会话</strong><span>从收件箱选择一条消息查看详情,或直接发送一条团队消息。</span></div></div>
        {composer}
      </section>
    );
  }

  const Avatar = activeSession.avatar;
  const approvalTitle = approvalState === 'pending' ? '等待负责人确认' : approvalState === 'approved' ? '已批准并启动' : approvalState === 'transferred' ? '已转交负责人' : '已驳回请求';
  const statusLabel = activeSession.statusLabel ?? (approvalState === 'pending' ? '待负责人确认' : approvalTitle);
  const body = activeSession.body ?? activeSession.preview;

  return (
    <section className="mh-thread" aria-labelledby="mh-thread-title">
      <div className="mh-thread-header">
        <div className="mh-breadcrumb"><span>{activeSession.source}</span><span>›</span><span>{activeSession.category}</span></div>
        <div className="mh-thread-title-row">
          <span className={cn('mh-sender-avatar', 'mh-sender-avatar-large', `tone-${activeSession.tone}`)}><Avatar /></span>
          <div><h2 id="mh-thread-title">{activeSession.sender} <span className={cn('mh-status-chip', approvalState === 'pending' ? 'tone-amber' : 'tone-purple')}>{statusLabel}</span></h2><p>来自 {activeSession.source} · <time>{activeSession.time}</time></p>{activeSession.binding?.task && <p>关联:{activeSession.binding.task}</p>}</div>
          <div className="mh-thread-actions"><button type="button" className="mh-quiet-button" onClick={() => undefined}>↪ 标记已读</button><button type="button" className="mh-quiet-button" onClick={() => onApproval('transfer')}>转交</button><button type="button" className="mh-quiet-button" aria-label="更多消息操作"><Ellipsis /></button></div>
        </div>
      </div>

      <div className="mh-thread-content">
        <article className="mh-message-block"><span className={cn('mh-sender-avatar', `tone-${activeSession.tone}`)}><Avatar /></span><div className="mh-message-card"><div className="mh-message-meta"><strong>{activeSession.sender}</strong><time>{activeSession.time}</time></div>{body.split('\n').map((line, index) => <p key={index}>{line}</p>)}{(activeSession.attachments?.length ?? 0) > 0 && <div className="mh-attachment-box"><strong>附件({activeSession!.attachments!.length})</strong><div className="mh-attachment-list">{activeSession!.attachments!.map((attachment) => <Attachment key={attachment.label} label={attachment.label} size={attachment.size} />)}</div></div>}</div></article>
        {activeSession.approval && (
          <article className={cn('mh-approval-card', approvalState !== 'pending' && 'is-resolved')} role="alertdialog" aria-labelledby="mh-approval-title"><div className="mh-approval-heading"><span className="mh-approval-icon"><Bot /></span><div><p>AI 协作请求</p><h3 id="mh-approval-title">{approvalTitle}</h3></div></div><p>{activeSession.question ?? '此请求需要你确认是否分配给 AI Agent 执行并绑定到具体项目与任务。'}</p>{approvalState === 'pending' ? <><div className="mh-approval-actions"><button type="button" className="mh-primary-button" onClick={() => onApproval('approve')}>批准</button><button type="button" className="mh-secondary-button" onClick={() => onApproval('reject')}>驳回</button><button type="button" className="mh-secondary-button" onClick={() => onApproval('transfer')}>转交</button></div>{(activeSession.options?.length ?? 0) > 0 && <p className="mh-approval-options">选项:{(activeSession.options ?? []).join(' / ')}(批准时默认选第一项)</p>}</> : <div className="mh-resolved-note"><CheckCircle2 /> 已记录处理结果</div>}</article>
        )}
        {replies.map((reply, index) => <article key={`${reply}-${index}`} className="mh-message-block mh-user-message"><span className="mh-sender-avatar mh-user-avatar">{userName.slice(0, 1)}</span><div className="mh-message-card"><div className="mh-message-meta"><strong>{userName}</strong><time>刚刚</time></div><p>{reply}</p></div></article>)}
      </div>

      {composer}
    </section>
  );
}

function Attachment({ label, size }: { label: string; size: string }) {
  return <button type="button" className="mh-attachment"><FileText /><span>{label}<small>{size}</small></span></button>;
}
