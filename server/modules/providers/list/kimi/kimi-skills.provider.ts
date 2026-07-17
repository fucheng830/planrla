import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getKimiCodeHome } from '@/modules/providers/list/kimi/kimi-auth.provider.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findProviderSkillMarkdownFiles,
  readProviderSkillMarkdownDefinition,
  readProviderSkillMarkdownDefinitionFromContent,
} from '@/shared/utils.js';

const KIMI_PROJECT_SKILL_DIRS = [
  ['.kimi-code', 'skills'],
  ['.agents', 'skills'],
];

export class KimiSkillsProvider extends SkillsProvider {
  constructor() {
    super('kimi');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const projectRoot = await this.findProjectRoot(workspacePath);
    // Kimi Code invokes skills as `/skill:<name>`, which does not fit the plain
    // `commandPrefix + name` shape, so every source carries a command builder.
    const commandForSkill = (skillName: string): string => `/skill:${skillName}`;

    for (const skillDir of KIMI_PROJECT_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'project',
        rootDir: path.join(projectRoot, ...skillDir),
        commandForSkill,
      });
    }

    // $KIMI_CODE_HOME/skills follows the env override, while ~/.agents/skills
    // is a shared cross-agent folder that always resolves from the home dir.
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getKimiCodeHome(), 'skills'),
      commandForSkill,
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      commandForSkill,
    });

    return sources;
  }

  /**
   * Extends the shared directory-style scan (`<name>/SKILL.md`) with Kimi
   * Code's flat `<name>.md` form. A directory-style skill always wins over a
   * flat file with the same skill name in the same source root.
   */
  override async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const sources = await this.getSkillSources(workspacePath);
    const skills: ProviderSkill[] = [];

    for (const source of sources) {
      const seenSkillNames = new Set<string>();

      for (const skillPath of await findProviderSkillMarkdownFiles(source.rootDir)) {
        try {
          const definition = await readProviderSkillMarkdownDefinition(skillPath);
          seenSkillNames.add(definition.name);
          skills.push(this.buildProviderSkill(source, definition, skillPath));
        } catch {
          // A malformed or unreadable skill markdown file should not hide other valid skills.
        }
      }

      for (const skillPath of await this.findFlatSkillMarkdownFiles(source.rootDir)) {
        try {
          const definition = readProviderSkillMarkdownDefinitionFromContent(
            await readFile(skillPath, 'utf8'),
            path.basename(skillPath).replace(/\.md$/i, ''),
          );
          if (seenSkillNames.has(definition.name)) {
            continue;
          }

          seenSkillNames.add(definition.name);
          skills.push(this.buildProviderSkill(source, definition, skillPath));
        } catch {
          // A malformed or unreadable skill markdown file should not hide other valid skills.
        }
      }
    }

    return skills;
  }

  /**
   * Resolves the project root as the nearest ancestor of the workspace that
   * contains a `.git` marker; falls back to the workspace itself outside repos.
   */
  private async findProjectRoot(workspacePath: string): Promise<string> {
    let currentPath = path.resolve(workspacePath);

    while (true) {
      try {
        const gitMarkerStats = await stat(path.join(currentPath, '.git'));
        if (gitMarkerStats.isDirectory() || gitMarkerStats.isFile()) {
          return currentPath;
        }
      } catch {
        // No `.git` marker at this level; keep walking up.
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return path.resolve(workspacePath);
      }

      currentPath = parentPath;
    }
  }

  /**
   * Finds flat `<name>.md` skill files directly under a skill root. A stray
   * root-level `SKILL.md` is ignored because it cannot map to a skill name.
   */
  private async findFlatSkillMarkdownFiles(rootDir: string): Promise<string[]> {
    try {
      const entries = await readdir(rootDir, { withFileTypes: true });
      return entries
        .filter((entry) => (
          entry.isFile()
          && entry.name.toLowerCase().endsWith('.md')
          && entry.name.toLowerCase() !== 'skill.md'
        ))
        .map((entry) => path.join(rootDir, entry.name))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  }

  private buildProviderSkill(
    source: ProviderSkillSource,
    definition: { name: string; description: string },
    skillPath: string,
  ): ProviderSkill {
    return {
      provider: this.provider,
      name: definition.name,
      description: definition.description,
      command: source.commandForSkill
        ? source.commandForSkill(definition.name)
        : `${source.commandPrefix ?? '/'}${definition.name}`,
      scope: source.scope,
      sourcePath: skillPath,
      pluginName: source.pluginName,
      pluginId: source.pluginId,
    };
  }
}
