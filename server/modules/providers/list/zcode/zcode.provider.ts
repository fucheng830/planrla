import { ZcodeProviderAuth } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { ZcodeProviderModels } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { ZcodeMcpProvider } from '@/modules/providers/list/zcode/zcode-mcp.provider.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { ZcodeSkillsProvider } from '@/modules/providers/list/zcode/zcode-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/**
 * ZCode (Z.AI) provider. Unlike the other CLI providers which spawn a one-shot
 * process per prompt, ZCode exposes a long-lived stdio "app-server" that speaks
 * a private NDJSON protocol (the ZCode Protocol). The spawn wrapper in
 * server/zcode-cli.js drives that protocol; this class only wires up the six
 * sub-handlers the registry expects.
 */
export class ZcodeProvider extends AbstractProvider {
  readonly models: IProviderModels = new ZcodeProviderModels();
  readonly mcp = new ZcodeMcpProvider();
  readonly auth: IProviderAuth = new ZcodeProviderAuth();
  readonly skills: IProviderSkills = new ZcodeSkillsProvider();
  readonly sessions: IProviderSessions = new ZcodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ZcodeSessionSynchronizer();

  constructor() {
    super('zcode');
  }
}
