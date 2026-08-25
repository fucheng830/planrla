import { useEffect, useMemo, useState } from 'react';
import { Bell, Bot, MessageSquare, User } from 'lucide-react';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { useKanban } from '../../kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';
import { InboxThreadDetail } from './InboxThreadDetail';
import type { InboxChannelId, InboxFilterId } from './inboxModel';
import { buildInboxThreads, type CronRunInfo, type RunningSessionInfo } from './inboxThreads';

const CHANNEL_FILTERS: Array<{ id: InboxChannelId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI 协作' },
  { id: 'team', label: '团队协作' },
  { id: 'external', label: '外部渠道' },
  { id: 'system', label: '系统任务' },
];

const QUICK_FILTERS: Array<{ id: InboxFilterId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'waiting', label: '待确认' },
  { id: 'mine', label: '@我' },
];

/** Live sources currently feeding the inbox. External-channel adapters land
 *  with the Message Hub backend; until then this row shows only real data. */
const CONNECTED_SOURCES = ['看板任务', '运行会话', '定时任务'];

export function InboxPage({ project }: { project: Project }) {
  const { tasks, loading: kanbanLoading, error: kanbanError } = useKanban();
  const [channel, setChannel] = useState<InboxChannelId>('all');
  const [filter, setFilter] = useState<InboxFilterId>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [runningSessions, setRunningSessions] = useState<RunningSessionInfo[]>([]);
  const [cronTasks, setCronTasks] = useState<CronRunInfo[]>([]);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/providers/sessions/running').then(async (res) => {
        if (!res.ok) throw new Error(`running sessions failed: ${res.status}`);
        const data = (await res.json()) as { sessions?: RunningSessionInfo[] };
        return data.sessions ?? [];
      }),
      api.get('/cron-prompts').then(async (res) => {
        if (!res.ok) throw new Error(`cron-prompts failed: ${res.status}`);
        const data = (await res.json()) as { data?: CronRunInfo[] };
        return data.data ?? [];
      }),
    ])
      .then(([sessions, crons]) => {
        if (cancelled) return;
        setRunningSessions(sessions);
        setCronTasks(crons);
        setSourcesError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSourcesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [project.projectId]);

  const threads = useMemo(
    () => buildInboxThreads({ projectName: project.displayName, tasks, runningSessions, cronTasks }),
    [project.displayName, tasks, runningSessions, cronTasks],
  );

  const waitingCount = useMemo(() => threads.filter((t) => t.state === 'waiting').length, [threads]);

  const visibleThreads = threads.filter((thread) => {
    if (channel !== 'all' && thread.channel !== channel) return false;
    const isUnread = thread.unread && !readIds.has(thread.id);
    if (filter === 'unread') return isUnread;
    if (filter === 'waiting') return thread.state === 'waiting';
    if (filter === 'mine') return thread.unread || thread.starred;
    return true;
  });

  const selectedThread = threads.find((t) => t.id === selectedId) ?? null;
  const unreadCount = threads.filter((t) => t.unread && !readIds.has(t.id)).length;

  if (selectedThread) {
    return (
      <div className="h-full bg-workbench-canvas">
        <InboxThreadDetail
          thread={selectedThread}
          projectName={project.displayName}
          onBack={() => setSelectedId(null)}
        />
      </div>
    );
  }

  return (
    <PageShell>
      <PageToolbar
        title="消息盒子"
        description="看板任务、运行会话与定时任务的实时消息(外部渠道适配接入后统一进入此处)"
        filters={
          <>
            {QUICK_FILTERS.map((f) => (
              <FilterChip
                key={f.id}
                label={f.label}
                active={filter === f.id}
                count={f.id === 'unread' ? unreadCount : undefined}
                onClick={() => setFilter(f.id)}
              />
            ))}
          </>
        }
      />

      {(kanbanLoading || sourcesError) && (
        <p
          role={sourcesError ? 'alert' : 'status'}
          className={`rounded-md border px-3 py-2 text-sm ${
            sourcesError
              ? 'border-workbench-danger/30 bg-workbench-danger/10 text-workbench-danger'
              : 'border-workbench-border bg-workbench-muted text-workbench-subtle'
          }`}
        >
          {sourcesError ? `部分数据源加载失败:${sourcesError}` : '正在加载消息数据…'}
        </p>
      )}
      {kanbanError && (
        <p className="rounded-md border border-workbench-danger/30 bg-workbench-danger/10 px-3 py-2 text-sm text-workbench-danger">
          看板数据加载失败:{kanbanError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="ds-panel h-fit p-2" aria-label="频道">
          <ul className="space-y-1">
            {CHANNEL_FILTERS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setChannel(c.id)}
                  className={`ds-focus-ring flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors ${
                    channel === c.id ? 'bg-workbench-accent/10 font-medium text-workbench-accent' : 'text-workbench-subtle hover:bg-workbench-muted hover:text-workbench-ink'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {c.id === 'ai' && <Bot className="size-3.5" aria-hidden="true" />}
                    {c.id === 'team' && <User className="size-3.5" aria-hidden="true" />}
                    {c.id === 'external' && <MessageSquare className="size-3.5" aria-hidden="true" />}
                    {c.id === 'system' && <Bell className="size-3.5" aria-hidden="true" />}
                    {c.label}
                  </span>
                  {c.id === 'ai' && waitingCount > 0 && <span className="ds-mono text-xs">{waitingCount}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="ds-divider my-2" />
          <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-workbench-subtle">实时数据源</p>
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {CONNECTED_SOURCES.map((source) => (
              <span key={source} className="rounded border border-workbench-border bg-workbench-muted px-1.5 py-0.5 text-[10px] text-workbench-subtle">{source}</span>
            ))}
          </div>
        </nav>

        <section className="ds-panel overflow-hidden" aria-label="消息列表">
          <ul className="divide-y divide-workbench-border">
            {visibleThreads.map((thread) => {
              const isUnread = thread.unread && !readIds.has(thread.id);
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(thread.id);
                      setReadIds((prev) => new Set(prev).add(thread.id));
                    }}
                    className="ds-focus-ring flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-workbench-muted"
                  >
                    <span className={`mt-1 size-2 flex-shrink-0 rounded-full ${isUnread ? 'bg-workbench-accent' : 'border border-workbench-border bg-transparent'}`} aria-label={isUnread ? '未读' : '已读'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`min-w-0 truncate text-sm ${isUnread ? 'font-semibold text-workbench-ink' : 'font-medium text-workbench-ink'}`}>{thread.title}</span>
                        <span className="flex-shrink-0 text-xs text-workbench-subtle">{thread.time}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-workbench-subtle">
                        <span className="flex-shrink-0 rounded bg-workbench-muted px-1 py-0.5">{thread.source}</span>
                        <span className="truncate">{thread.preview}</span>
                      </span>
                    </span>
                    <span className="mt-1 flex-shrink-0"><WorkbenchStatus state={thread.state === 'waiting' ? 'waiting' : thread.state === 'running' ? 'running' : thread.stateLabel === '失败' ? 'failed' : 'complete'} label={thread.stateLabel} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visibleThreads.length === 0 && (
            <p className="py-10 text-center text-sm text-workbench-subtle">当前筛选下没有消息:看板任务等待确认、运行中会话与定时任务执行记录会实时出现在这里</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
