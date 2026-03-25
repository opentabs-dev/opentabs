import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawMcpTool, mapMcpTool, mcpToolSchema } from './schemas.js';

interface ToolSearchRouteData {
  toolSearchResult: { results: Array<{ sourceType: string; tool: RawMcpTool }> };
}

export const searchTools = defineTool({
  name: 'search_tools',
  displayName: 'Search Tools',
  description:
    'Search for MCP tools across all servers in the Glama directory. Returns matching tools with their parent server information.',
  summary: 'Search for MCP tools across all servers',
  icon: 'search',
  group: 'MCP Tools',
  input: z.object({
    q: z.string().describe('Search query to find MCP tools'),
  }),
  output: z.object({
    tools: z.array(mcpToolSchema).describe('Matching MCP tools'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<ToolSearchRouteData>(
      `/mcp/tools?q=${encodeURIComponent(params.q)}`,
      'routes/_public/mcp/tools/_index/_route',
    );

    const tools = (data.toolSearchResult?.results ?? []).map(r => mapMcpTool(r.tool));

    return { tools };
  },
});
