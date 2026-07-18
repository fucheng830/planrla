import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import toml from '@iarna/toml';
import crossSpawn from 'cross-spawn';

import { getKimiCodeHome, resolveKimiBinary } from '@/modules/providers/list/kimi/kimi-auth.provider.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const KIMI_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'kimi-code/kimi-for-coding',
      label: 'Kimi For Coding',
      description: 'kimi-code - kimi-for-coding',
    },
    {
      value: 'kimi-code/kimi-for-coding-highspeed',
      label: 'Kimi For Coding Highspeed',
      description: 'kimi-code - kimi-for-coding-highspeed',
    },
    {
      value: 'kimi-code/k3',
      label: 'Kimi K3',
      description: 'kimi-code - k3',
    },
  ],
  DEFAULT: 'kimi-code/kimi-for-coding',
};

const KIMI_MODELS_TIMEOUT_MS = 20_000;
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

const readKimiMaxContextSize = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
);

const mapKimiListedModel = (alias: string, rawModel: unknown): ProviderModelOption => {
  const record = readObjectRecord(rawModel);
  const label = readOptionalString(record?.displayName)
    ?? readOptionalString(record?.display_name)
    ?? alias;
  const providerId = readOptionalString(record?.provider);
  const modelId = readOptionalString(record?.model) ?? alias;
  const maxContextSize = readKimiMaxContextSize(record?.maxContextSize ?? record?.max_context_size);

  const descriptionParts = [providerId ? `${providerId} - ${modelId}` : modelId];
  if (maxContextSize) {
    descriptionParts.push(`max context ${maxContextSize}`);
  }

  return {
    value: alias,
    label,
    description: descriptionParts.join(' · '),
  };
};

export const parseKimiProviderListStdout = (stdout: string): ProviderModelOption[] => {
  const parsed = readObjectRecord(JSON.parse(stdout));
  const models = readObjectRecord(parsed?.models);
  if (!models) {
    return [];
  }

  const options: ProviderModelOption[] = [];
  for (const [alias, rawModel] of Object.entries(models)) {
    if (!alias.trim()) {
      continue;
    }

    options.push(mapKimiListedModel(alias, rawModel));
  }

  return options;
};

const readKimiConfiguredDefaultModel = async (): Promise<string | null> => {
  try {
    const content = await readFile(path.join(getKimiCodeHome(), 'config.toml'), 'utf8');
    const config = readObjectRecord(toml.parse(content));
    return readOptionalString(config?.default_model) ?? null;
  } catch {
    return null;
  }
};

const buildKimiModelsDefinition = (
  options: ProviderModelOption[],
  configuredDefault: string | null,
): ProviderModelsDefinition => ({
  OPTIONS: options,
  DEFAULT: configuredDefault ?? options[0]?.value ?? KIMI_FALLBACK_MODELS.DEFAULT,
});

const runKimiProviderListCommand = (): Promise<string> => new Promise((resolve, reject) => {
  const kimiProcess = spawnFunction(resolveKimiBinary(), ['provider', 'list', '--json'], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    kimiProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('kimi provider list timed out'));
    }
  }, KIMI_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    resolve(output);
  };

  kimiProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  kimiProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  kimiProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  kimiProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `kimi provider list exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

export class KimiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const configuredDefault = await readKimiConfiguredDefaultModel();

    try {
      const stdout = await runKimiProviderListCommand();
      const options = parseKimiProviderListStdout(stdout);
      if (options.length === 0) {
        return buildKimiModelsDefinition(KIMI_FALLBACK_MODELS.OPTIONS, configuredDefault);
      }

      return buildKimiModelsDefinition(options, configuredDefault);
    } catch {
      return buildKimiModelsDefinition(KIMI_FALLBACK_MODELS.OPTIONS, configuredDefault);
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const configuredDefault = await readKimiConfiguredDefaultModel();
    if (configuredDefault) {
      return {
        model: configuredDefault,
      };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('kimi', input);
  }
}
