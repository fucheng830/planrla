import { Archive, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from './utils';

import type { MessageChannel } from './messageHubData';

type MessageHubRailProps = {
  channels: MessageChannel[];
  total: number;
  activeChannel: string;
  onChannelSelect: (id: string) => void;
};

export function MessageHubRail({ channels, total, activeChannel, onChannelSelect }: MessageHubRailProps) {
  return (
    <aside className="mh-rail" aria-label="频道">
      <div className="mh-panel-heading">
        <span>频道</span>
        <button type="button" className="mh-icon-button mh-icon-button-small" aria-label="添加频道" onClick={() => toast('频道创建入口已准备')}><Plus /></button>
      </div>
      <nav className="mh-channel-list" aria-label="消息频道">
        <button type="button" className={cn('mh-channel-item', activeChannel === 'all' && 'is-active')} onClick={() => onChannelSelect('all')}>
          <span className="mh-channel-logo tone-blue"><ChevronLeft /></span>
          <span>全部消息</span>
          <span className="mh-count-pill">{total}</span>
        </button>        {channels.map((channel) => {
          const Icon = channel.icon;
          return (
            <button key={channel.id} type="button" className={cn('mh-channel-item', activeChannel === channel.id && 'is-active')} onClick={() => onChannelSelect(channel.id)}>
              <span className={cn('mh-channel-logo', `tone-${channel.tone}`)}><Icon /></span>
              <span>{channel.label}</span>
              <span className="mh-count-pill">{channel.count}</span>
            </button>
          );
        })}
      </nav>
      <div className="mh-rail-footer">
        <button type="button" className="mh-rail-footer-item" onClick={() => toast('已打开归档消息')}><Archive /><span>归档消息</span></button>
        <button type="button" className="mh-rail-footer-item" onClick={() => toast('已打开回收站')}><Trash2 /><span>回收站</span></button>
      </div>
    </aside>
  );
}
