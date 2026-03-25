import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawMcpServerSummary, mapMcpServerSummary, mcpServerSummarySchema } from './schemas.js';

interface CategoryServersRouteData {
  mcpServers: RawMcpServerSummary[];
}

export const listServersByCategory = defineTool({
  name: 'list_servers_by_category',
  displayName: 'List Servers by Category',
  description:
    'List MCP servers in a specific category. Provide the category slug (e.g. "browser-automation") to get all servers in that category.',
  summary: 'List MCP servers in a specific category',
  icon: 'list',
  group: 'MCP Servers',
  input: z.object({
    slug: z.string().describe('Category slug (e.g. "browser-automation")'),
  }),
  output: z.object({
    servers: z.array(mcpServerSummarySchema).describe('MCP servers in the category'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<CategoryServersRouteData>(
      `/mcp/servers/categories/${encodeURIComponent(params.slug)}`,
      'routes/_public/mcp/servers/categories/~slug/_route',
    );

    const servers = (data.mcpServers ?? []).map(mapMcpServerSummary);

    return { servers };
  },
});
