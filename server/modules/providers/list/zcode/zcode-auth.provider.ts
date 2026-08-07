import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/**
 * ZCode stores all user data under ~/.zcode (CLI state under ~/.zcode/cli).
 * The desktop app also honours $ZCODE_WINDOWS_APP_INSTALL_DIR on Windows to
 * locate its own install, which we reuse to find the bundled CLI bundle.
 */
export function getZcodeCliHome(): string {
  return path.join(os.homedir(), '.zcode', 'cli');
}

export function getZcodeHome(): string {
  return path.join(os.homedir(), '.zcode');
}

let cachedZcodeBinary: { node: string; script: string } | null = null;

/**
 * Resolves the ZCode CLI. ZCode ships as a desktop app that bundles
 * `resources/glm/zcode.cjs` (a node bundle exposing the `app-server` /
 * `--prompt` surface). We prefer that bundled script, then fall back to a
 * `zcode` on PATH (a standalone CLI install), so the same code works whether
 * the user only has the desktop app or a CLI install.
 *
 * Returns [nodeExecutable, scriptPath]; when the bundled script is not found
 * and no `zcode` is on PATH, a best-effort fallback is returned so callers get
 * a clean "not installed" result from spawn rather than an import error.
 */
export function resolveZcodeBinary(): { node: string; script: string } {
  if (cachedZcodeBinary) {
    return cachedZcodeBinary;
  }

  // 1. Bundled script inside the desktop app install dir.
  const installDir = process.env.ZCODE_WINDOWS_APP_INSTALL_DIR;
  if (installDir) {
    const script = path.join(installDir, 'resources', 'glm', 'zcode.cjs');
    if (fsSync.existsSync(script)) {
      cachedZcodeBinary = { node: process.execPath, script };
      return cachedZcodeBinary;
    }
  }
  if (process.platform !== 'win32') {
    const candidates = [
      path.join('/usr', 'local', 'share', 'zcode', 'resources', 'glm', 'zcode.cjs'),
      path.join(os.homedir(), '.zcode', 'app', 'resources', 'glm', 'zcode.cjs'),
    ];
    for (const script of candidates) {
      if (fsSync.existsSync(script)) {
        cachedZcodeBinary = { node: process.execPath, script };
        return cachedZcodeBinary;
      }
    }
  }

  // 2. Standalone `zcode` on PATH.
  try {
    const result = spawn.sync('zcode', ['--version'], { stdio: 'ignore', timeout: 5000 });
    if (!result.error && result.status === 0) {
      // Sentinel: spawn the bare `zcode` binary directly (node/script unused).
      cachedZcodeBinary = { node: 'zcode', script: '' };
      return cachedZcodeBinary;
    }
  } catch {
    // Fall through to fallback.
  }

  // 3. Best-effort fallback (caller will observe not-installed via spawn error).
  cachedZcodeBinary = { node: 'zcode', script: '' };
  return cachedZcodeBinary;
}

/**
 * Whether the resolved ZCode CLI can actually be executed.
 */
export function isZcodeInstalled(): boolean {
  const { node, script } = resolveZcodeBinary();
  try {
    const args = script ? [script, '--version'] : ['--version'];
    const result = spawn.sync(node, args, { stdio: 'ignore', timeout: 8000 });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export class ZcodeProviderAuth implements IProviderAuth {
  /**
   * Returns ZCode CLI installation + model configuration status.
   *
   * "Authenticated" for ZCode means a model provider is configured in
   * ~/.zcode/cli/config.json (without it the CLI refuses to run with
   * "Model config is missing").
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = isZcodeInstalled();
    const configured = this.checkModelConfigured();

    return {
      installed,
      provider: 'zcode',
      authenticated: configured,
      email: configured ? 'zcode model config' : null,
      method: configured ? 'config_file' : null,
      error: configured ? undefined : installed ? 'No model provider configured in ~/.zcode/cli/config.json' : 'ZCode CLI not found',
    };
  }

  /**
   * A model provider is considered configured when ~/.zcode/cli/config.json
   * contains a non-empty `model.main` (the field the CLI requires). We do not
   * read the API key value itself.
   */
  private checkModelConfigured(): boolean {
    try {
      const configPath = path.join(getZcodeCliHome(), 'config.json');
      if (!fsSync.existsSync(configPath)) return false;
      const content = fsSync.readFileSync(configPath, 'utf8');
      const config = JSON.parse(content) as { model?: { main?: unknown } };
      return Boolean(config?.model?.main);
    } catch {
      return false;
    }
  }
}
