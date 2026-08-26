import { Bell, Home, Search, Settings, SlidersHorizontal, Users } from 'lucide-react';

import { cn } from '../../lib/utils';
import { messageSessions } from './messageHubData';

export function MessageHubPhonePreview() {
  return (
    <aside className="mh-phone-preview" aria-label="手机端消息预览">
      <div className="mh-phone-speaker" />
      <div className="mh-phone-screen">
        <div className="mh-phone-status"><span>21:50</span><span>▮▮▮ ◷</span></div>
        <div className="mh-phone-header"><strong>消息协作中枢</strong><span><Search /><SlidersHorizontal /></span></div>
        <div className="mh-phone-tabs"><span className="is-active">全部 <b>65</b></span><span>待处理 <b>12</b></span><span>AI 请求 <b>9</b></span></div>
        <div className="mh-phone-sessions">{messageSessions.slice(0, 6).map((session, index) => { const Icon = session.avatar; return <button key={session.id} type="button" className={cn('mh-phone-session', index === 0 && 'is-active')}><span className={cn('mh-sender-avatar', `tone-${session.tone}`)}><Icon /></span><span><strong>{session.sender}</strong><small>{session.source} · {session.time}</small><em>{session.preview}</em></span>{session.unread && <b>{session.unread}</b>}</button>; })}</div>
        <nav className="mh-phone-nav" aria-label="手机导航"><span><Home /><small>频道</small></span><span className="is-active"><Bell /><small>消息</small><b>12</b></span><span><Users /><small>任务</small></span><span><Settings /><small>设置</small></span></nav>
      </div>
    </aside>
  );
}
