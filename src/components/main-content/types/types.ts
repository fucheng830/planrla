import type { Dispatch, SetStateAction } from 'react';

import type { AppTab, Project, ProjectSession } from '../../../types/app';
import type { ExtensionTabId } from '../../extension-panel/hooks/useExtensionPanel';
import type {
  MarkSessionCompleted,
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';
import type { SessionEstablishedContext, SessionNavigationOptions } from '../../chat/types/types';
import type { PickerCandidateSession } from '../../chat/view/subcomponents/SessionReferencePicker';
import type { SettingsMainTab } from '../../settings/types/types';

export type MainContentProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionProcessing: MarkSessionProcessing;
  onSessionIdle: MarkSessionIdle;
  onSessionCompleted: MarkSessionCompleted;
  processingSessions: SessionActivityMap;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  /** Cross-project session candidates for the SessionReferencePicker's
   *  "search all" mode. Undefined degrades the picker to current-project
   *  filtering only. Built by AppContent from the full projects array. */
  allPickerSessions?: PickerCandidateSession[];
  /** Message-level fork: branches a new conversation from a specific message. */
  onForkAtMessage?: (sessionId: string, upToTimestamp: string | number) => void;
  /** Toggle the bottom terminal panel (shell tab is now a panel toggle). */
  onToggleTerminalPanel?: () => void;
};

export type MainContentHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  /** When set, the shell tab toggles the bottom terminal panel instead of
   *  switching to a full-screen shell tab. */
  onToggleTerminalPanel?: () => void;
  /** Toggle the right-side extension panel (Markdown/Review/Browser/Kanban/Cron). */
  onToggleExtension?: () => void;
  isExtensionOpen?: boolean;
  /** Active tab inside the right-side extension panel (null when closed/none). */
  extensionActiveTab?: ExtensionTabId | null;
  /** Toggle a tab inside the right-side extension panel. */
  onToggleExtensionTab?: (id: ExtensionTabId) => void;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowBrowserTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
};

export type MainContentStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
};

export type MobileMenuButtonProps = {
  onMenuClick: () => void;
  compact?: boolean;
};
