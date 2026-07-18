import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// Provider MCP configs are read-modify-write file updates. Startup
// auto-registrations (session-query, a2a, browser-use) and UI actions can fire
// several mutations at the same files concurrently, which loses updates and
// can interleave two writers into a corrupt file. Serialize all mutations
// through one promise chain; reads stay unqueued.
let mcpMutationQueue: Promise<unknown> = Promise.resolve();

const enqueueMcpMutation = <T>(mutation: () => Promise<T>): Promise<T> => {
  const run = mcpMutationQueue.then(mutation);
  mcpMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};


export const providerMcpService = {
  /**
   * Lists MCP servers for one provider grouped by supported scopes.
   */
  async listProviderMcpServers(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServers(options);
  },

  /**
   * Lists MCP servers for one provider scope.
   */
  async listProviderMcpServersForScope(
    providerName: string,
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServersForScope(scope, options);
  },

  /**
   * Adds or updates one provider MCP server.
   */
  async upsertProviderMcpServer(
    providerName: string,
    input: UpsertProviderMcpServerInput,
  ): Promise<ProviderMcpServer> {
    return enqueueMcpMutation(() => {
      const provider = providerRegistry.resolveProvider(providerName);
      return provider.mcp.upsertServer(input);
    });
  },

  /**
   * Removes one provider MCP server.
   */
  async removeProviderMcpServer(
    providerName: string,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    return enqueueMcpMutation(() => {
      const provider = providerRegistry.resolveProvider(providerName);
      return provider.mcp.removeServer(input);
    });
  },

  /**
   * Adds one HTTP/stdio MCP server to every provider.
   */
  async addMcpServerToAllProviders(
    input: Omit<UpsertProviderMcpServerInput, 'scope'> & { scope?: Exclude<McpScope, 'local'> },
  ): Promise<Array<{ provider: LLMProvider; created: boolean; error?: string }>> {
    if (input.transport !== 'stdio' && input.transport !== 'http') {
      throw new AppError('Global MCP add supports only "stdio" and "http".', {
        code: 'INVALID_GLOBAL_MCP_TRANSPORT',
        statusCode: 400,
      });
    }

    const scope = input.scope ?? 'project';
    return enqueueMcpMutation(async () => {
      const results: Array<{ provider: LLMProvider; created: boolean; error?: string }> = [];
      const providers = providerRegistry.listProviders();
      for (const provider of providers) {
        try {
          await provider.mcp.upsertServer({ ...input, scope });
          results.push({ provider: provider.id, created: true });
        } catch (error) {
          results.push({
            provider: provider.id,
            created: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return results;
    });
  },

  /**
   * Removes one MCP server from every provider. Mirrors `addMcpServerToAllProviders`
   * by iterating the live provider registry, so callers stay in sync with which
   * providers exist instead of maintaining their own provider list.
   */
  async removeMcpServerFromAllProviders(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<Array<{ provider: LLMProvider; removed: boolean; error?: string }>> {
    return enqueueMcpMutation(async () => {
      const results: Array<{ provider: LLMProvider; removed: boolean; error?: string }> = [];
      const providers = providerRegistry.listProviders();
      for (const provider of providers) {
        try {
          const result = await provider.mcp.removeServer(input);
          results.push({ provider: provider.id, removed: result.removed });
        } catch (error) {
          results.push({
            provider: provider.id,
            removed: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return results;
    });
  },
};
