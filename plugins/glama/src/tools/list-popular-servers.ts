import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import {
  type RawDirectoryStats,
  type RawMcpServerSummary,
  directoryStatsSchema,
  mapDirectoryStats,
  mapMcpServerSummary,
  mcpServerSummarySchema,
} from './schemas.js';

interface ServersRouteData {
  serverSearchResult: { results: RawMcpServerSummary[] };
  stats: RawDirectoryStats;
}

export const listPopularServers = defineTool({
  name: 'list_popular_servers',
  displayName: 'List Popular Servers',
  description:
    'List popular or trending MCP servers from the Glama directory. Defaults to sorting by popularity. Returns server summaries and directory statistics.',
  summary: 'List popular MCP servers from the directory',
  icon: 'trending-up',
  group: 'MCP Servers',
  input: z.object({
    sort: z
      .enum(['popularity:desc', 'recently-added:desc', 'name:asc'])
      .optional()
      .describe('Sort order for the listing'),
  }),
  output: z.object({
    servers: z.array(mcpServerSummarySchema).describe('Popular MCP servers'),
    stats: directoryStatsSchema.describe('Directory-wide statistics'),
  }),
  handle: async params => {
    const sort = params.sort ?? 'popularity:desc';

    const data = await navigateAndLoad<ServersRouteData>(
      `/mcp/servers?sort=${encodeURIComponent(sort)}`,
      'routes/_public/mcp/servers/_index/_route',
    );

    const servers = (data.serverSearchResult?.results ?? []).map(mapMcpServerSummary);
    const stats = mapDirectoryStats(data.stats ?? {});

    return { servers, stats };
  },
});
