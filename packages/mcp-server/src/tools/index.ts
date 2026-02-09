import { registerTools as registerBrowserTools } from './browser/index.js';
import { registerTools as registerDatadogTools } from './datadog/index.js';
import { registerTools as registerExtensionTools } from './extension/index.js';
import { registerTools as registerLogrocketTools } from './logrocket/index.js';
import { registerTools as registerRetoolTools } from './retool/index.js';
import { registerTools as registerSlackTools } from './slack/index.js';
import { registerTools as registerSnowflakeTools } from './snowflake/index.js';
import { registerTools as registerSqlpadTools } from './sqlpad/index.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Tool registration function signature.
 * Each service directory exports a `registerTools` function matching this type.
 */
type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

/**
 * All service tool registrations. Adding a new service requires only adding
 * its `registerTools` import above and one entry here.
 */
const SERVICE_REGISTRATIONS: ToolRegistrationFn[] = [
  registerSlackTools,
  registerDatadogTools,
  registerSqlpadTools,
  registerLogrocketTools,
  registerRetoolTools,
  registerSnowflakeTools,
  registerExtensionTools,
  registerBrowserTools,
];

/**
 * Register all tools on the MCP server and return references to each RegisteredTool.
 *
 * The returned map enables hot reload: on file change, tool handlers and metadata
 * can be updated in-place via RegisteredTool.update() without disconnecting clients.
 */
export const registerAllTools = (server: McpServer): Map<string, RegisteredTool> => {
  const allTools = new Map<string, RegisteredTool>();

  for (const register of SERVICE_REGISTRATIONS) {
    for (const [name, tool] of register(server)) {
      allTools.set(name, tool);
    }
  }

  return allTools;
};
