import { success, reloadExtension, defineTool } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerExtensionReloadTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  defineTool(
    tools,
    server,
    'reload_extension',
    {
      description:
        'Reload the OpenTabs Chrome extension. Useful after building a new version of the extension to pick up changes without manually refreshing. The extension will briefly disconnect and automatically reconnect.',
      inputSchema: {},
    },
    async () => {
      await reloadExtension();
      return success({
        message: 'Extension reload initiated. The extension will disconnect briefly and reconnect automatically.',
      });
    },
  );

  return tools;
};
