export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini' | 'opencode' | 'kimi' | 'zcode';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type ProviderModelsCacheInfo = {
  updatedAt: string;
  expiresAt: string;
  source: 'memory' | 'disk' | 'fresh';
};

export type AppTab =
  | 'chat'
  | 'files'
  | 'shell'
  | 'git'
  | 'overview'
  | 'inbox'
  | 'workflow'
  | 'schedule'
  | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  // REQ-051 session context menu: surfaces the pin flag and transcript path so
  // the sidebar can sort pinned sessions first and offer "copy log path".
  isPinned?: boolean;
  jsonlPath?: string | null;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export interface Project {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  /** Persisted manual order (drag-and-drop). -1/undefined = no manual order. */
  sortIndex?: number;
  /** 项目工作区当前 git 分支(后端解析,悬浮卡展示);非 git 目录为 null。 */
  branch?: string | null;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  [key: string]: unknown;
}

export interface LoadingProgress {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}
