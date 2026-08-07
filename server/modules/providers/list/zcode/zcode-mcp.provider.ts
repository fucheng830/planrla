import fsSync from 'node:fs';
import path from 'node:path';

import { getZcodeCliHome } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError, readJsonConfig, readObjectRecord, readOptionalString, readStringArray, readStringRecord } from '@/shared/utils.js';

/**
 * ZCode keeps MCP servers in the user-level ~/.zcode/cli/config.json under
 * `mcp.servers`. Only the user scope is supported for reads (ZCode manages its
 * own project/workspace scoping internally); writes are rejected because the
 * file format and watcher are owned by the ZCode app itself.
 */
const USER_MCP_CONFIG_PATH = path.join(getZcodeCliHome(), 'config.json');

export class ZcodeMcpProvider extends McpProvider {
  constructor() {
    super('zcode', ['user'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    if (scope !== 'user') return {};
    try {
      const config = await readJsonConfig(USER_MCP_CONFIG_PATH);
      const mcp = readObjectRecord(config.mcp);
      return readObjectRecord(mcp?.servers) ?? {};
    } catch {
      return {};
    }
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('Editing ZCode MCP servers from Planrla is not supported; manage them in ZCode settings.', {
      code: 'ZCODE_MCP_READ_ONLY',
      statusCode: 400,
    });
  }

  protected buildServerConfig(_input: UpsertProviderMcpServerInput): Record<string, unknown> {
    throw new AppError('Editing ZCode MCP servers from Planrla is not supported.', {
      code: 'ZCODE_MCP_READ_ONLY',
      statusCode: 400,
    });
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) return null;

    // Suppress unused-var lint for fsSync (kept for future use).
    void fsSync;

    if (typeof config.command === 'string') {
      return {
        provider: 'zcode',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'zcode',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.headers),
        bearerTokenEnvVar: readOptionalString(config.bearerTokenEnvVar),
      };
    }

    return null;
  }
}
