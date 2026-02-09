import { registerBrowserTabsTools } from './browser/index.js';
import { registerDatadogTools } from './datadog/index.js';
import { registerExtensionReloadTools } from './extension/index.js';
import { registerLogrocketTools } from './logrocket/index.js';
import { registerRetoolTools } from './retool/index.js';
import { registerSlackTools } from './slack/index.js';
import { registerSnowflakeTools } from './snowflake/index.js';
import { registerSqlpadTools } from './sqlpad/index.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register all tools on the MCP server and return references to each RegisteredTool.
 *
 * The returned map enables hot reload: on file change, tool handlers and metadata
 * can be updated in-place via RegisteredTool.update() without disconnecting clients.
 */
export const registerAllTools = (server: McpServer): Map<string, RegisteredTool> => {
  const allTools = new Map<string, RegisteredTool>();

  const registrations = [
    registerSlackTools,
    registerDatadogTools,
    registerSqlpadTools,
    registerLogrocketTools,
    registerRetoolTools,
    registerSnowflakeTools,
    registerExtensionReloadTools,
    registerBrowserTabsTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      allTools.set(name, tool);
    }
  }

  return allTools;
};

// Re-export for direct access
export * from './datadog/index.js';
export * from './extension/index.js';
export * from './browser/index.js';
export * from './logrocket/index.js';
export * from './retool/index.js';
export * from './slack/index.js';
export * from './snowflake/index.js';
export * from './sqlpad/index.js';
