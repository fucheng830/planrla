import * as Tabs from '@radix-ui/react-tabs';
import { Filter, ListFilter, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

import type { MessageSession } from './messageHubData';

type MessageHubInboxProps = {
  sessions: MessageSession[];
  activeSessionId?: string;
  onSessionSelect: (session: MessageSession) => void;
  /** Extra heading action (e.g. 登记客户咨询 button). */
  action?: ReactNode;
};

const FIXED_FILTERS: ReadonlyArray<{ value: string; label: string; tone?: string }> = [
  { value: 'all', label: '全部消息' },
  { value: '待处理', label: '待处理', tone: 'amber' },
  { value: 'AI 请求', label: 'AI 请求', tone: 'purple' },
  { value: '客户消息', label: '客户消息', tone: 'green' },
  { value: '团队消息', label: '团队消息', tone: 'blue' },
];

export function MessageHubInbox({ sessions, activeSessionId, onSessionSelect, action }: MessageHubInboxProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const tabs = useMemo<Array<{ value: string; label: string; count: number; tone?: string }>>(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) counts.set(session.category, (counts.get(session.category) ?? 0) + 1);
    const fixed = FIXED_FILTERS.map((item) => ({ ...item, count: item.value === 'all' ? sessions.length : (counts.get(item.value) ?? 0) }));
    const extras = [...counts.keys()]
      .filter((category) => !FIXED_FILTERS.some((item) => item.value === category))
      .map((category) => ({ value: category, label: category, count: counts.get(category) ?? 0 }));
    return [...fixed, ...extras];
  }, [sessions]);

  const unreadTotal = useMemo(() => sessions.reduce((sum, session) => sum + ((session.unread ?? 0) > 0 ? 1 : 0), 0), [sessions]);

  const visible = useMemo(() => sessions.filter((session) => {
    const matchesQuery = `${session.sender} ${session.source} ${session.preview}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || session.category === filter;
    return matchesQuery && matchesFilter;
  }), [filter, query, sessions]);

  return (
    <section className="mh-inbox" aria-labelledby="mh-inbox-title">
      <div className="mh-panel-heading">
        <h1 id="mh-inbox-title">收件箱</h1>
        <div className="mh-heading-actions">
          {action}
          <ListFilter aria-hidden="true" />
          {unreadTotal > 0 && <span className="mh-unread-badge">{unreadTotal}</span>}
        </div>
      </div>
      <label className="mh-inbox-search">
        <Search aria-hidden="true" />
        <input type="search" aria-label="筛选收件箱" placeholder="筛选会话..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <Tabs.Root value={filter} onValueChange={setFilter} className="mh-inbox-tabs">
        <Tabs.List aria-label="收件箱筛选">
          {tabs.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} className="mh-inbox-tab">
              {item.tone && <i className={cn('mh-dot', `tone-${item.tone}`)} />}
              <span>{item.label}</span><b>{item.count}</b>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="mh-list-toolbar"><span>按时间排序</span><Filter aria-hidden="true" /><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="打开收件箱筛选"><Filter /></button></div>
      <div className="mh-session-list" aria-label="会话列表">
        {visible.length > 0 ? visible.map((session) => <SessionCard key={session.id} session={session} active={session.id === activeSessionId} onSelect={onSessionSelect} />) : <p className="mh-empty-list">没有匹配的会话</p>}
      </div>
    </section>
  );
}

function SessionCard({ session, active, onSelect }: { session: MessageSession; active: boolean; onSelect: (session: MessageSession) => void }) {
  const Icon = session.avatar;
  return (
    <button type="button" className={cn('mh-session-card', active && 'is-active')} data-session-id={session.id} onClick={() => onSelect(session)}>
      <span className={cn('mh-sender-avatar', `tone-${session.tone}`)}><Icon /></span>
      <span className="mh-session-copy"><strong>{session.sender}</strong><small>{session.source} · {session.category}</small><span>{session.preview}</span></span>
      <time>{session.time}</time>
      {session.approval && <b className="mh-session-status">{session.statusLabel ?? '待确认'}</b>}
      {!!session.unread && session.unread > 0 && <em>{session.unread}</em>}
    </button>
  );
}
