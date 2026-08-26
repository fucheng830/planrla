import { AtSign, Bot, CheckCircle2, Ellipsis, FileText, Paperclip, Plus, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { cn } from '../../lib/utils';
import type { MessageSession } from './messageHubData';

type MessageHubThreadProps = {
  activeSession: MessageSession;
  replies: string[];
  approvalState: 'pending' | 'approved' | 'rejected' | 'transferred';
  onSend: (message: string) => void;
  onApproval: (action: 'approve' | 'reject' | 'transfer') => void;
};

export function MessageHubThread({ activeSession, replies, approvalState, onSend, onApproval }: MessageHubThreadProps) {
  const [draft, setDraft] = useState('');
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    onSend(message);
    setDraft('');
  };

  const approvalTitle = approvalState === 'pending' ? '等待负责人确认' : approvalState === 'approved' ? '已批准并启动' : approvalState === 'transferred' ? '已转交负责人' : '已驳回请求';
  const statusLabel = approvalState === 'pending' ? '待负责人确认' : approvalTitle;

  return (
    <section className="mh-thread" aria-labelledby="mh-thread-title">
      <div className="mh-thread-header">
        <div className="mh-breadcrumb"><span>{activeSession.source}</span><span>›</span><span>{activeSession.category}</span></div>
        <div className="mh-thread-title-row">
          <span className={cn('mh-sender-avatar', 'mh-sender-avatar-large', `tone-${activeSession.tone}`)}><Bot /></span>
          <div><h2 id="mh-thread-title">{activeSession.sender} <span className={cn('mh-status-chip', approvalState === 'pending' ? 'tone-amber' : 'tone-purple')}>{statusLabel}</span></h2><p>来自 {activeSession.source} · <time>{activeSession.time}</time></p><p>频道：Windows 打包失败分析与修复建议</p></div>
          <div className="mh-thread-actions"><button type="button" className="mh-quiet-button" onClick={() => undefined}>↪ 标记已读</button><button type="button" className="mh-quiet-button" onClick={() => onApproval('transfer')}>转交</button><button type="button" className="mh-quiet-button" aria-label="更多消息操作"><Ellipsis /></button></div>
        </div>
      </div>

      <div className="mh-thread-content">
        <article className="mh-message-block"><span className="mh-sender-avatar tone-purple"><Bot /></span><div className="mh-message-card"><div className="mh-message-meta"><strong>AI: Codex</strong><time>21:49</time></div><p>请协助分析 Windows 打包失败问题并给出修复建议。</p><p>错误摘要：Windows packaging failed after latest dependency update.</p><p>- 缺失依赖：vcruntime140_1.dll<br />- 构建环境：GitHub Actions / windows-latest<br />- 影响版本：v2.3.1+</p><p>相关日志与构建产物已上传至附件。</p><div className="mh-attachment-box"><strong>附件（3）</strong><div className="mh-attachment-list"><Attachment label="build_log.txt" size="58 KB" /><Attachment label="error_trace.log" size="126 KB" /><Attachment label="artifact.zip" size="4.2 MB" /></div></div></div></article>
        <article className={cn('mh-approval-card', approvalState !== 'pending' && 'is-resolved')} role="alertdialog" aria-labelledby="mh-approval-title"><div className="mh-approval-heading"><span className="mh-approval-icon"><Bot /></span><div><p>AI 协作请求</p><h3 id="mh-approval-title">{approvalTitle}</h3></div></div><p>此请求需要你确认是否分配给 AI Agent 执行并绑定到具体项目与任务。</p>{approvalState === 'pending' ? <div className="mh-approval-actions"><button type="button" className="mh-primary-button" onClick={() => onApproval('approve')}>批准</button><button type="button" className="mh-secondary-button" onClick={() => onApproval('reject')}>驳回</button><button type="button" className="mh-secondary-button" onClick={() => onApproval('transfer')}>转交</button></div> : <div className="mh-resolved-note"><CheckCircle2 /> 已记录处理结果</div>}</article>
        <article className="mh-message-block mh-user-message"><span className="mh-sender-avatar mh-user-avatar">王</span><div className="mh-message-card"><div className="mh-message-meta"><strong>王工</strong><time>21:52</time></div><p>请先绑定到 Planrla 系统项目的 Windows 打包任务。</p></div></article>
        {replies.map((reply, index) => <article key={`${reply}-${index}`} className="mh-message-block mh-user-message"><span className="mh-sender-avatar mh-user-avatar">王</span><div className="mh-message-card"><div className="mh-message-meta"><strong>王工</strong><time>刚刚</time></div><p>{reply}</p></div></article>)}
      </div>

      <form className="mh-composer" aria-label="回复消息" onSubmit={handleSubmit}><textarea aria-label="回复消息" placeholder="回复消息..." rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="mh-composer-toolbar"><div><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加表情"><span>☺</span></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加附件"><Paperclip /></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="提及成员"><AtSign /></button><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加上下文"><Plus /></button></div><button type="submit" className="mh-send-button">发送 <Send /></button></div></form>
    </section>
  );
}

function Attachment({ label, size }: { label: string; size: string }) {
  return <button type="button" className="mh-attachment"><FileText /><span>{label}<small>{size}</small></span></button>;
}
