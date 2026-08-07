import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';

/**
 * ZCode exposes skills via its own plugin system (managed in-app). Planrla does
 * not introspect those; we only surface the shared cross-agent ~/.agents/skills
 * folder so user-authored skills remain visible. Source discovery for ZCode's
 * own plugin skills can be added later by reading its plugin manifest.
 */
export class ZcodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('zcode');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
    });

    return sources;
  }
}
