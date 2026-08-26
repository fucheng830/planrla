import { Archive, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '../../lib/utils';
import { messageChannels } from './messageHubData';

export function MessageHubRail() {
  return (
    <aside className="mh-rail" aria-label="频道">
      <div className="mh-panel-heading">
        <span>频道</span>
        <button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加频道" onClick={() => toast('频道创建入口已准备')}><Plus /></button>
      </div>
      <nav className="mh-channel-list" aria-label="消息频道">
        {messageChannels.map((channel, index) => {
          const Icon = channel.icon;
          return (
            <button key={channel.id} type="button" className={cn('mh-channel-item', index === 0 && 'is-active')} onClick={() => toast(`已切换到${channel.label}`)}>
              <span className={cn('mh-channel-logo', `tone-${channel.tone}`)}><Icon /></span>
              <span>{channel.label}</span>
              <span className="mh-count-pill">{channel.count}</span>
            </button>
          );
        })}
      </nav>
      <div className="mh-rail-footer">
        <button type="button" className="mh-rail-footer-item" onClick={() => toast('已打开归档消息')}><Archive /><span>归档消息</span><em>45</em></button>
        <button type="button" className="mh-rail-footer-item" onClick={() => toast('已打开回收站')}><Trash2 /><span>回收站</span><em>2</em></button>
        <button type="button" className="mh-collapse-button" aria-label="收起频道栏"><ChevronLeft /><ChevronLeft /></button>
      </div>
    </aside>
  );
}
