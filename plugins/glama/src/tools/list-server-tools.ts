import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawMcpTool, mapMcpTool, mcpToolSchema } from './schemas.js';

interface ServerDetailRouteData {
  tools: RawMcpTool[];
}

export const listServerTools = defineTool({
  name: 'list_server_tools',
  displayName: 'List Server Tools',
  description:
    'List all tools provided by a specific MCP server. Returns tool names, descriptions, and parent server metadata.',
  summary: 'List tools provided by an MCP server',
  icon: 'wrench',
  group: 'MCP Servers',
  input: z.object({
    namespace: z.string().describe('Owner/namespace slug of the server'),
    slug: z.string().describe('Server slug'),
  }),
  output: z.object({
    tools: z.array(mcpToolSchema).describe('Tools provided by this server'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<ServerDetailRouteData>(
      `/mcp/servers/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.slug)}`,
      'routes/_public/mcp/servers/~namespace/~slug/_pages/_index/_route',
    );

    const tools = (data.tools ?? []).map(mapMcpTool);

    return { tools };
  },
});
