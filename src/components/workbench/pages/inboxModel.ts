export type InboxChannelId = 'all' | 'ai' | 'team' | 'external' | 'system';
export type InboxFilterId = 'all' | 'unread' | 'waiting' | 'mine';

export type InboxThread = {
  id: string;
  title: string;
  sender: string;
  source: string;
  channel: Exclude<InboxChannelId, 'all'>;
  preview: string;
  time: string;
  unread: boolean;
  starred: boolean;
  state: 'waiting' | 'running' | 'complete';
  stateLabel: string;
};

export const DELIVERY_STAGES = ['需求设计', '技术方案', '开工', '测试验证', '交付'] as const;
