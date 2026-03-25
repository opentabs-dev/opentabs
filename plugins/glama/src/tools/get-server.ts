import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import {
  type RawMcpServerDetail,
  type RawMcpTool,
  mapMcpServerDetail,
  mapMcpTool,
  mcpServerDetailSchema,
  mcpToolSchema,
} from './schemas.js';

interface ServerRouteData {
  mcpServer: RawMcpServerDetail;
  tools?: RawMcpTool[];
  discussionCommentCount?: number;
}

export const getServer = defineTool({
  name: 'get_server',
  displayName: 'Get Server',
  description:
    'Get detailed information about a specific MCP server, including its description, scores, integrations, tools, and discussion comment count.',
  summary: 'Get detailed information about an MCP server',
  icon: 'server',
  group: 'MCP Servers',
  input: z.object({
    namespace: z.string().describe('Owner/namespace slug of the server'),
    slug: z.string().describe('Server slug'),
  }),
  output: z.object({
    server: mcpServerDetailSchema.describe('Detailed server information'),
    tools: z.array(mcpToolSchema).describe('Tools provided by this server'),
    discussionCommentCount: z.number().int().describe('Number of discussion comments'),
  }),
  handle: async params => {
    const data = await navigateAndLoad<ServerRouteData>(
      `/mcp/servers/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.slug)}`,
      'routes/_public/mcp/servers/~namespace/~slug/_pages/_index/_route',
    );

    const server = mapMcpServerDetail(data.mcpServer ?? {});
    const tools = (data.tools ?? []).map(mapMcpTool);
    const discussionCommentCount = data.discussionCommentCount ?? 0;

    return { server, tools, discussionCommentCount };
  },
});
