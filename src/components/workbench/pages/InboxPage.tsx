import { useMemo, useState } from 'react';
import { ArrowLeft, Bell, Bot, MessageSquare, Star, User } from 'lucide-react';

import type { Project } from '../../../types/app';
import { useKanban } from '../../kanban';
import { WorkbenchStatus } from '../WorkbenchStatus';

import { FilterChip, PageShell, PageToolbar } from './PageShell';

type ChannelId = 'all' | 'ai' | 'team' | 'external' | 'system';
type FilterId = 'all' | 'unread' | 'waiting' | 'mine';

type ThreadItem = {
  id: string;
  title: string;
  sender: string;
  source: string;
  channel: Exclude<ChannelId, 'all'>;
  preview: string;
  time: string;
  unread: boolean;
  starred: boolean;
  state: 'waiting' | 'running' | 'complete';
  stateLabel: string;
};

const CHANNEL_FILTERS: Array<{ id: ChannelId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI 协作' },
  { id: 'team', label: '团队协作' },
  { id: 'external', label: '外部渠道' },
  { id: 'system', label: '系统任务' },
];

const QUICK_FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'waiting', label: '待确认' },
  { id: 'mine', label: '@我' },
];

const EXTERNAL_SOURCES = ['微信', '企业微信', '飞书', '钉钉', 'Slack', '闲鱼客服', '小红书客服', 'TikTok 客服', '抖音客服'];

function buildThreads(projectName: string, waitingCount: number): ThreadItem[] {
  const threads: ThreadItem[] = [
    {
      id: 'ai-confirm',
      title: '请求确认：技术方案边界',
      sender: 'Planrla Agent',
      source: 'AI 协作',
      channel: 'ai',
      preview: '方案 A 数据库迁移风险较低，但需要你确认是否允许在线 DDL。',
      time: '2 分钟前',
      unread: true,
      starred: true,
      state: 'waiting',
      stateLabel: '等待确认',
    },
    {
      id: 'team-review',
      title: '设计评审：消息盒子信息架构',
      sender: '林川',
      source: '团队协作',
      channel: 'team',
      preview: '第二版把渠道分组提前了，右侧上下文栏保留绑定对象。',
      time: '26 分钟前',
      unread: true,
      starred: false,
      state: 'running',
      stateLabel: '进行中',
    },
    {
      id: 'external-douyin',
      title: '抖音客服：活动视频交付时间',
      sender: '客户 A',
      source: '抖音客服',
      channel: 'external',
      preview: '请问霸王餐活动的视频今天能出第一版吗？',
      time: '1 小时前',
      unread: false,
      starred: true,
      state: 'waiting',
      stateLabel: '待回复',
    },
    {
      id: 'system-cron',
      title: '定时任务提醒：每日站会同步',
      sender: '系统',
      source: '定时任务',
      channel: 'system',
      preview: '09:30 生成昨日进展摘要，并推送到项目频道。',
      time: '3 小时前',
      unread: false,
      starred: false,
      state: 'complete',
      stateLabel: '已执行',
    },
  ];

  if (waitingCount > 0) {
    threads.unshift({
      id: 'kanban-waiting',
      title: `${projectName} 有 ${waitingCount} 个任务等待人工确认`,
      sender: 'Planrla Agent',
      source: 'AI 协作',
      channel: 'ai',
      preview: '看板任务已暂停，进入研发流程处理后自动继续。',
      time: '刚刚',
      unread: true,
      starred: false,
      state: 'waiting',
      stateLabel: '等待确认',
    });
  }

  return threads;
}

function ThreadDetail({ thread, onBack }: { thread: ThreadItem; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <article className="ds-surface rounded-md p-3">
            <div className="flex items-center gap-2 text-xs text-workbench-subtle">
              {thread.channel === 'ai' ? <Bot className="size-3.5" aria-hidden="true" /> : <User className="size-3.5" aria-hidden="true" />}
              <span className="font-medium text-workbench-ink">{thread.sender}</span>
              <span>· {thread.time}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-workbench-ink">{thread.preview}</p>
          </article>

          {thread.channel === 'ai' && (
            <div className="rounded-md border border-workbench-waiting/40 bg-workbench-waiting/5 p-3">
              <p className="text-sm font-medium text-workbench-ink">协作请求</p>
              <p className="mt-1 text-xs text-workbench-subtle">需要人工确认后 AI 才能继续执行。</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="ds-focus-ring rounded-md bg-workbench-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">允许</button>
                <button type="button" className="ds-focus-ring rounded-md border border-workbench-border px-3 py-1.5 text-xs font-medium text-workbench-ink hover:bg-workbench-muted">拒绝</button>
                <button type="button" className="ds-focus-ring rounded-md border border-workbench-border px-3 py-1.5 text-xs font-medium text-workbench-ink hover:bg-workbench-muted">转交</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-workbench-border bg-workbench-surface p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="回复线程，@成员或附上文件…"
            className="ds-focus-ring h-9 min-w-0 flex-1 rounded-md border border-workbench-border bg-workbench-surface px-3 text-sm text-workbench-ink placeholder:text-workbench-subtle"
          />
          <button type="button" className="ds-focus-ring h-9 rounded-md bg-workbench-accent px-4 text-sm font-medium text-white hover:opacity-90">发送</button>
        </div>
      </footer>
    </div>
  );
}

export function InboxPage({ project }: { project: Project }) {
  const { tasks } = useKanban();
  const [channel, setChannel] = useState<ChannelId>('all');
  const [filter, setFilter] = useState<FilterId>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const waitingCount = useMemo(() => tasks.filter((t) => t.status === 'waiting_user').length, [tasks]);
  const threads = useMemo(() => buildThreads(project.displayName, waitingCount), [project.displayName, waitingCount]);

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
        <ThreadDetail thread={selectedThread} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <PageShell>
      <PageToolbar
        title="消息盒子"
        description="统一接收外部渠道、团队、AI 协作与系统任务消息"
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
          <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-workbench-subtle">已接入渠道</p>
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {EXTERNAL_SOURCES.map((source) => (
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
                    {thread.starred && <Star className="mt-1 size-3.5 flex-shrink-0 fill-workbench-waiting text-workbench-waiting" aria-label="重要" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {visibleThreads.length === 0 && (
            <p className="py-10 text-center text-sm text-workbench-subtle">当前筛选下没有消息</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
