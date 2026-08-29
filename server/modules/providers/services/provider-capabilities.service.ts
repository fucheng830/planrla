import type { LLMProvider } from '@/shared/types.js';

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /**
   * Whether chat.compact can compress this session's context (REQ-052).
   * Compaction relies on the CLI's built-in /compact slash command, which only
   * the Claude SDK runtime processes headlessly — every other provider is
   * rejected by the chat.compact capability check before any run starts.
   */
  supportsCompact: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsCompact: true,
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsCompact: false,
  },
  codex: {
    provider: 'codex',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsCompact: false,
  },
  gemini: {
    provider: 'gemini',
    // gemini-cli only recognizes default / auto_edit / yolo (server/gemini-cli.js).
    // auto_edit stays in the settings PermissionsContent path; the chat cycle only
    // toggles default↔yolo (both chat PermissionMode values the runtime accepts).
    permissionModes: ['default', 'yolo'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsCompact: false,
  },
  opencode: {
    provider: 'opencode',
    permissionModes: ['default'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsCompact: false,
  },
  kimi: {
    provider: 'kimi',
    // kimi -p (headless) always runs under the CLI's own auto permission policy;
    // --yolo/--auto/--plan cannot be combined with -p, so no mode is switchable.
    permissionModes: ['default'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    // wire.jsonl carries usage.record events, but the token-usage endpoint has
    // no kimi branch yet.
    supportsTokenUsage: false,
    supportsCompact: false,
  },
  zcode: {
    provider: 'zcode',
    // ZCode app-server runs with its own configured permission mode (build by
    // default); permission prompts are auto-denied in headless mode, so no mode
    // is switchable from the composer.
    permissionModes: ['default'],
    defaultPermissionMode: 'default',
    supportsImages: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    // Telemetry usage.delta events exist; token-usage endpoint has no zcode branch yet.
    supportsTokenUsage: false,
    supportsCompact: false,
  },
};

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
