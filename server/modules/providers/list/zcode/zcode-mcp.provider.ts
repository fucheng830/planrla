import path from 'node:path';

import { getZcodeCliHome } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError, readJsonConfig, readObjectRecord, readOptionalString, readStringArray, readStringRecord, writeJsonConfig } from '@/shared/utils.js';

/**
 * ZCode keeps MCP servers in the user-level ~/.zcode/cli/config.json under
 * `mcp.servers`. Only the user scope is supported for reads (ZCode manages its
 * own project/workspace scoping internally). Planrla writes only user-scoped
 * HTTP MCP entries and preserves all unrelated ZCode configuration.
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
    scope: McpScope,
    _workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope !== 'user') {
      throw new AppError('ZCode MCP schedules only support user scope.', {
        code: 'ZCODE_MCP_SCOPE_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
    const config = await readJsonConfig(USER_MCP_CONFIG_PATH);
    const currentMcp = readObjectRecord(config.mcp) ?? {};
    await writeJsonConfig(USER_MCP_CONFIG_PATH, {
      ...config,
      mcp: { ...currentMcp, servers },
    });
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport !== 'http' || !input.url) {
      throw new AppError('ZCode Planrla integration only supports HTTP MCP servers.', {
        code: 'ZCODE_MCP_TRANSPORT_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
    return {
      url: input.url,
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.bearerTokenEnvVar ? { bearerTokenEnvVar: input.bearerTokenEnvVar } : {}),
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) return null;

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
