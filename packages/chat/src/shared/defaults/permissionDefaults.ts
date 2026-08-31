import type { LLMProvider } from '../../types/app';
import type { PermissionMode } from '../../components/chat/types/types';

export const BYPASS_MODE_BY_PROVIDER: Partial<Record<LLMProvider, PermissionMode>> = {
  claude: 'bypassPermissions',
  codex: 'bypassPermissions',
  cursor: 'bypassPermissions',
  gemini: 'yolo',
};

const STORAGE_KEY = 'default-permission-mode';
export const DEFAULT_PERMISSION_ACK_KEY = 'default-permission-ack';

/** 读取 per-provider 默认权限模式（整张表）。 */
export function getDefaultPermissionModes(): Partial<Record<LLMProvider, PermissionMode>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 设置某 provider 的默认权限模式（持久化）。 */
export function setDefaultPermissionMode(provider: LLMProvider, mode: PermissionMode): void {
  const all = getDefaultPermissionModes();
  all[provider] = mode;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * 解析某 session 应使用的权限模式，优先级：
 *   1. permissionMode-${sessionId}（该 session 记忆）
 *   2. 全局默认 default-permission-mode[provider]
 *   3. 'default'
 */
export function resolveSessionPermissionMode(
  provider: LLMProvider,
  sessionId: string | null | undefined,
): PermissionMode {
  if (sessionId) {
    const saved = localStorage.getItem(`permissionMode-${sessionId}`) as PermissionMode | null;
    if (saved) return saved;
  }
  const globalDefault = getDefaultPermissionModes()[provider];
  if (globalDefault) return globalDefault;
  return 'default';
}

/** 用户是否已确认"默认不限权限"风险（一次性确认）。 */
export function isPermissionAcked(): boolean {
  return localStorage.getItem(DEFAULT_PERMISSION_ACK_KEY) === '1';
}

export function setPermissionAcked(): void {
  localStorage.setItem(DEFAULT_PERMISSION_ACK_KEY, '1');
}
