import fsSync from 'node:fs';
import path from 'node:path';

import { getZcodeCliHome } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

/**
 * Hardcoded fallback catalog used when the CLI/config cannot be introspected.
 * ZCode's default desktop install ships with BigModel GLM-5.2.
 */
export const ZCODE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'builtin:bigmodel-coding-plan/GLM-5.2',
      label: 'GLM-5.2 (BigModel Coding Plan)',
      description: 'BigModel - Coding Plan · GLM-5.2',
    },
  ],
  DEFAULT: 'builtin:bigmodel-coding-plan/GLM-5.2',
};

/**
 * Reads the model configured in ~/.zcode/cli/config.json. The CLI expects
 * `model.main` as either a `"provider/model"` string or `{provider, model}`.
 * Returns the string form used by the model catalog, or null when absent.
 */
const readConfiguredModel = (): string | null => {
  try {
    const configPath = path.join(getZcodeCliHome(), 'config.json');
    if (!fsSync.existsSync(configPath)) return null;
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8')) as {
      model?: { main?: unknown };
    };
    const main = config?.model?.main;
    if (typeof main === 'string') return main;
    if (main && typeof main === 'object') {
      const rec = main as Record<string, unknown>;
      const provider = readOptionalString(rec.provider);
      const model = readOptionalString(rec.model);
      if (provider && model) return `${provider}/${model}`;
    }
    return null;
  } catch {
    return null;
  }
};

export class ZcodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const configured = readConfiguredModel();
    if (configured) {
      return {
        OPTIONS: [
          {
            value: configured,
            label: configured.split('/').pop() || configured,
            description: configured,
          },
          ...ZCODE_FALLBACK_MODELS.OPTIONS,
        ],
        DEFAULT: configured,
      };
    }
    return ZCODE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const configured = readConfiguredModel();
    if (configured) {
      return { model: configured };
    }
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('zcode', input);
  }
}
