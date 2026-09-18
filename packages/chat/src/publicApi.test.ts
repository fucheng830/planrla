import type { ComponentType } from 'react';

import type {
  ChatComposerProps,
  ChatMessagesPaneProps,
  ChatSessionProps,
  MessageComponentProps,
  PermissionRequestsBannerProps,
} from './index';

const sessionComponent: ComponentType<ChatSessionProps> = null as unknown as typeof import('./index').ChatSession;
const messagesComponent: ComponentType<ChatMessagesPaneProps> = null as unknown as typeof import('./index').ChatMessagesPane;
const composerComponent: ComponentType<ChatComposerProps> = null as unknown as typeof import('./index').ChatComposer;
const messageComponent: ComponentType<MessageComponentProps> = null as unknown as typeof import('./index').MessageComponent;
const permissionComponent: ComponentType<PermissionRequestsBannerProps> = null as unknown as typeof import('./index').PermissionRequestsBanner;

void [
  sessionComponent,
  messagesComponent,
  composerComponent,
  messageComponent,
  permissionComponent,
];
