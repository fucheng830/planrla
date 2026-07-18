import fsSync from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import toml from '@iarna/toml';
import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type KimiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const KIMI_ENV_CREDENTIAL_KEYS = [
  'MOONSHOT_API_KEY',
  'KIMI_API_KEY',
];

/**
 * Kimi Code stores all user data under $KIMI_CODE_HOME (default ~/.kimi-code).
 */
export function getKimiCodeHome(): string {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

let cachedKimiBinary: string | null = null;

/**
 * Resolves the kimi CLI executable. The native installer drops it under
 * <KIMI_CODE_HOME>/bin, which is not necessarily on PATH for long-running
 * server processes (on Windows it typically is not), so probe PATH first and
 * fall back to the install directory.
 */
export function resolveKimiBinary(): string {
  if (cachedKimiBinary) {
    return cachedKimiBinary;
  }

  try {
    const result = spawn.sync('kimi', ['--version'], { stdio: 'ignore', timeout: 5000 });
    if (!result.error && result.status === 0) {
      cachedKimiBinary = 'kimi';
      return cachedKimiBinary;
    }
  } catch {
    // Fall through to the install-dir candidate.
  }

  const candidate = path.join(
    getKimiCodeHome(),
    'bin',
    process.platform === 'win32' ? 'kimi.exe' : 'kimi',
  );
  cachedKimiBinary = fsSync.existsSync(candidate) ? candidate : 'kimi';
  return cachedKimiBinary;
}

export class KimiProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Kimi Code CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync(resolveKimiBinary(), ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Kimi Code CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'kimi',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Detects Kimi Code credentials without reading their contents:
   * the OAuth token store written by `kimi login`, an api_key in
   * config.toml, or a provider API key environment variable.
   */
  private async checkCredentials(): Promise<KimiCredentialsStatus> {
    const home = getKimiCodeHome();

    // `kimi login` (device-code OAuth) writes per-provider token stores under
    // <home>/credentials/ (e.g. kimi-code.json). Contents may be locked by a
    // running CLI, so only the directory listing is inspected.
    try {
      const entries = await readdir(path.join(home, 'credentials'));
      if (entries.some((entry) => entry.endsWith('.json'))) {
        return {
          authenticated: true,
          email: 'kimi-code credentials',
          method: 'credentials_file',
        };
      }
    } catch {
      // Missing credentials directory: fall through to the next source.
    }

    // API key providers configured directly in config.toml.
    try {
      const content = await readFile(path.join(home, 'config.toml'), 'utf8');
      const config = toml.parse(content);
      const providers = readObjectRecord(config.providers) ?? {};

      for (const [providerId, providerConfig] of Object.entries(providers)) {
        const providerRecord = readObjectRecord(providerConfig);
        if (providerRecord && readOptionalString(providerRecord.api_key)?.trim()) {
          return {
            authenticated: true,
            email: `${providerId} api key`,
            method: 'config_file',
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read Kimi Code config',
        };
      }
    }

    const envCredential = KIMI_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'Kimi Code not configured',
    };
  }
}
