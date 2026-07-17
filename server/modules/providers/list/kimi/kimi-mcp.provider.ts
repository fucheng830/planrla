import path from 'node:path';

import { getKimiCodeHome } from '@/modules/providers/list/kimi/kimi-auth.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

/**
 * Kimi Code keeps MCP servers in `{ "mcpServers": { <name>: {...} } }` files:
 * a user-level `$KIMI_CODE_HOME/mcp.json` shared across projects, and a
 * project-level `<workspace>/.kimi-code/mcp.json` whose entries override
 * same-named user entries.
 */
const resolveMcpConfigPath = (scope: McpScope, workspacePath: string): string =>
  scope === 'user'
    ? path.join(getKimiCodeHome(), 'mcp.json')
    : path.join(workspacePath, '.kimi-code', 'mcp.json');

export class KimiMcpProvider extends McpProvider {
  constructor() {
    super('kimi', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const config = await readJsonConfig(resolveMcpConfigPath(scope, workspacePath));
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = resolveMcpConfigPath(scope, workspacePath);
    const config = await readJsonConfig(filePath);
    config.mcpServers = servers;
    await writeJsonConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      const config: Record<string, unknown> = {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
      if (input.cwd?.trim()) {
        config.cwd = input.cwd;
      }

      return config;
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    const config: Record<string, unknown> = {
      url: input.url,
      headers: input.headers ?? {},
    };
    if (input.bearerTokenEnvVar?.trim()) {
      config.bearerTokenEnvVar = input.bearerTokenEnvVar;
    }

    return config;
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    if (typeof config.command === 'string') {
      return {
        provider: 'kimi',
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
      // Entries with `transport: "sse"` are legacy SSE servers. The raw field is
      // left untouched on disk (untouched entries round-trip verbatim), and the
      // server is surfaced as http to match the declared supportedTransports.
      return {
        provider: 'kimi',
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
