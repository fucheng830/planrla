import { ArrowLeft, Bot, CheckCircle2, Link2, User } from 'lucide-react';
import { useState } from 'react';

import { WorkbenchStatus } from '../WorkbenchStatus';

import { DELIVERY_STAGES, type InboxThread } from './inboxModel';

type ApprovalState = 'pending' | 'approved' | 'rejected' | 'transferred';

type InboxThreadDetailProps = {
  thread: InboxThread;
  projectName: string;
  onBack: () => void;
};

export function InboxThreadDetail({ thread, projectName, onBack }: InboxThreadDetailProps) {
  const [approval, setApproval] = useState<ApprovalState>(thread.state === 'waiting' ? 'pending' : 'approved');
  const [replies, setReplies] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const submitReply = () => {
    const message = draft.trim();
    if (!message) return;
    setReplies((current) => [...current, message]);
    setDraft('');
  };

  const approvalLabel: Record<ApprovalState, string> = {
    pending: '等待负责人确认',
    approved: '已批准并启动',
    rejected: '已驳回请求',
    transferred: '已转交负责人',
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="线程详情">
      <header className="ds-panel-header flex-shrink-0">
        <button type="button" onClick={onBack} className="ds-focus-ring rounded-md p-1.5 text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink" aria-label="返回消息列表">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-workbench-ink">{thread.title}</h2>
          <p className="text-xs text-workbench-subtle">{thread.sender} · {thread.source}</p>
        </div>
        <WorkbenchStatus state={thread.state} label={thread.stateLabel} />
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            <article className="ds-surface rounded-md p-3">
              <div className="flex items-center gap-2 text-xs text-workbench-subtle">
                {thread.channel === 'ai' ? <Bot className="size-3.5" aria-hidden="true" /> : <User className="size-3.5" aria-hidden="true" />}
                <span className="font-medium text-workbench-ink">{thread.sender}</span>
                <span>· {thread.time}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-workbench-ink">{thread.preview}</p>
            </article>

            {thread.channel === 'ai' && (
              <article className={`rounded-md border p-3 ${approval === 'pending' ? 'border-workbench-waiting/40 bg-workbench-waiting/5' : 'border-workbench-success/30 bg-workbench-success-soft/30'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-workbench-subtle">AI 协作请求</p>
                    <h3 className="mt-0.5 text-sm font-medium text-workbench-ink">{approvalLabel[approval]}</h3>
                  </div>
                  {approval !== 'pending' && <CheckCircle2 className="size-4 flex-shrink-0 text-workbench-success" aria-hidden="true" />}
                </div>
                <p className="mt-1 text-xs text-workbench-subtle">确认后请求将绑定到项目与研发流程任务，并继续执行后续阶段。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setApproval('approved')} className="ds-focus-ring rounded-md bg-workbench-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90" aria-label="批准并继续执行">批准</button>
                  <button type="button" onClick={() => setApproval('rejected')} className="ds-focus-ring rounded-md border border-workbench-border px-3 py-1.5 text-xs font-medium text-workbench-ink hover:bg-workbench-muted" aria-label="驳回协作请求">驳回</button>
                  <button type="button" onClick={() => setApproval('transferred')} className="ds-focus-ring rounded-md border border-workbench-border px-3 py-1.5 text-xs font-medium text-workbench-ink hover:bg-workbench-muted" aria-label="转交给负责人">转交</button>
                </div>
              </article>
            )}

            {replies.map((reply, index) => (
              <article key={`${reply}-${index}`} className="ds-surface ml-6 rounded-md p-3">
                <div className="flex items-center gap-2 text-xs text-workbench-subtle">
                  <span className="font-medium text-workbench-ink">你</span>
                  <span>· 刚刚</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-workbench-ink">{reply}</p>
              </article>
            ))}
          </div>

          <footer className="border-t border-workbench-border bg-workbench-surface p-3">
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="回复线程，@成员或附上文件…"
                className="ds-focus-ring h-9 min-w-0 flex-1 rounded-md border border-workbench-border bg-workbench-surface px-3 text-sm text-workbench-ink placeholder:text-workbench-subtle"
              />
              <button type="button" onClick={submitReply} className="ds-focus-ring h-9 rounded-md bg-workbench-accent px-4 text-sm font-medium text-white hover:opacity-90">发送</button>
            </div>
          </footer>
        </div>

        <aside className="hidden min-h-0 overflow-auto border-l border-workbench-border bg-workbench-canvas p-3 xl:block" aria-label="消息上下文">
          <section className="ds-panel p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-workbench-ink">
              <Link2 className="size-3.5" aria-hidden="true" />
              绑定信息
            </h3>
            <dl className="mt-2 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-workbench-subtle">绑定项目</dt>
                <dd className="min-w-0 truncate font-medium text-workbench-ink">{projectName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-workbench-subtle">绑定任务</dt>
                <dd className="min-w-0 truncate font-medium text-workbench-ink">技术方案确认</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-workbench-subtle">关联会话</dt>
                <dd className="min-w-0 truncate font-medium text-workbench-ink">当前线程</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-workbench-subtle">优先级</dt>
                <dd className="font-medium text-workbench-ink">高</dd>
              </div>
            </dl>
          </section>

          <section className="ds-panel mt-3 p-3">
            <h3 className="text-sm font-semibold text-workbench-ink">研发流程</h3>
            <ol className="mt-2 space-y-2 text-xs">
              {DELIVERY_STAGES.map((stage, index) => (
                <li key={stage} className="flex items-center gap-2" data-stage={index <= 1 ? 'complete' : index === 2 ? 'running' : 'waiting'}>
                  <span className={`size-2 flex-shrink-0 rounded-full ${index <= 1 ? 'bg-workbench-success' : index === 2 ? 'bg-workbench-accent' : 'border border-workbench-border'}`} />
                  <span className="text-workbench-ink">{stage}</span>
                  <span className="ml-auto text-workbench-subtle">{index <= 1 ? '完成' : index === 2 ? '进行中' : '待开始'}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}
