import * as Tabs from '@radix-ui/react-tabs';
import { Filter, ListFilter, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '../../lib/utils';
import { messageSessions, type MessageSession } from './messageHubData';

type MessageHubInboxProps = {
  activeSessionId: string;
  onSessionSelect: (session: MessageSession) => void;
};

const inboxFilters: Array<{ value: string; label: string; count: number; tone?: string }> = [
  { value: 'all', label: '全部消息', count: 65 },
  { value: '待处理', label: '待处理', count: 12, tone: 'amber' },
  { value: 'AI 请求', label: 'AI 请求', count: 9, tone: 'purple' },
  { value: '客户消息', label: '客户消息', count: 14, tone: 'green' },
  { value: '团队消息', label: '团队消息', count: 18, tone: 'blue' },
] as const;

export function MessageHubInbox({ activeSessionId, onSessionSelect }: MessageHubInboxProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const sessions = useMemo(() => messageSessions.filter((session) => {
    const matchesQuery = `${session.sender} ${session.source} ${session.preview}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' || session.category === filter;
    return matchesQuery && matchesFilter;
  }), [filter, query]);

  return (
    <section className="mh-inbox" aria-labelledby="mh-inbox-title">
      <div className="mh-panel-heading">
        <h1 id="mh-inbox-title">收件箱</h1>
        <div className="mh-heading-actions"><ListFilter aria-hidden="true" /><span className="mh-unread-badge">12</span></div>
      </div>
      <label className="mh-inbox-search">
        <Search aria-hidden="true" />
        <input type="search" aria-label="筛选收件箱" placeholder="筛选会话..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <Tabs.Root value={filter} onValueChange={setFilter} className="mh-inbox-tabs">
        <Tabs.List aria-label="收件箱筛选">
          {inboxFilters.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} className="mh-inbox-tab">
              {item.tone && <i className={cn('mh-dot', `tone-${item.tone}`)} />}
              <span>{item.label}</span><b>{item.count}</b>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="mh-list-toolbar"><span>按时间排序</span><Filter aria-hidden="true" /><button type="button" className="mh-icon-button mh-icon-button-small" aria-label="打开收件箱筛选"><Filter /></button></div>
      <div className="mh-session-list" aria-label="会话列表">
        {sessions.length > 0 ? sessions.map((session) => <SessionCard key={session.id} session={session} active={session.id === activeSessionId} onSelect={onSessionSelect} />) : <p className="mh-empty-list">没有匹配的会话</p>}
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
      {session.approval && <b className="mh-session-status">个性化确认</b>}
      {session.unread && <em>{session.unread}</em>}
    </button>
  );
}
