/**
 * Stdio MCP server entry point.
 *
 * A pure stdin/stdout MCP server for environments like Glama's container
 * inspection, where `mcp-proxy -- node platform/mcp-server/dist/stdio.js`
 * expects MCP JSON-RPC over stdin/stdout.
 *
 * This entry point does NOT start any HTTP server, WebSocket server, or
 * file watchers. It performs plugin discovery, registers browser tools,
 * and serves MCP requests over stdio.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfigDir } from '@opentabs-dev/shared';
import { browserTools } from './browser-tools/index.js';
import { loadConfig, loadSecret } from './config.js';
import { discoverPlugins } from './discovery.js';
import { createMcpServer, rebuildCachedBrowserTools } from './mcp-setup.js';
import { createState } from './state.js';

const main = async (): Promise<void> => {
  const state = createState();

  // Load config — non-fatal in Docker containers where ~/.opentabs/ may not exist
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    config = await loadConfig();
  } catch {
    process.stderr.write('Warning: Failed to load config, proceeding with defaults\n');
  }

  // Load secret — not needed for stdio but some code paths may reference it
  try {
    state.wsSecret = await loadSecret();
  } catch {
    // Non-fatal
  }

  // Apply config to state
  if (config) {
    state.pluginPermissions = config.permissions;
    state.pluginSettings = config.settings;
  }
  state.skipPermissions = process.env.OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS === '1';

  // Register browser tools
  state.browserTools = browserTools;
  rebuildCachedBrowserTools(state);

  // Discover plugins — non-fatal, server starts with browser tools only on failure
  if (config) {
    try {
      const { registry } = await discoverPlugins(
        config.localPlugins ?? [],
        getConfigDir(),
        config.settings,
        config.additionalAllowedDirectories,
      );
      state.registry = registry;
    } catch {
      process.stderr.write('Warning: Plugin discovery failed, proceeding with browser tools only\n');
    }
  }

  // Create MCP server (registers handlers internally) and connect via stdio
  const server = await createMcpServer(state);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
