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

interface SearchRouteData {
  serverSearchResult: { results: RawMcpServerSummary[] };
  stats: RawDirectoryStats;
}

export const searchServers = defineTool({
  name: 'search_servers',
  displayName: 'Search Servers',
  description:
    'Search for MCP servers in the Glama directory by keyword. Returns matching servers with metadata (stars, tools, language, license) and directory-wide statistics.',
  summary: 'Search for MCP servers in the Glama directory',
  icon: 'search',
  group: 'MCP Servers',
  input: z.object({
    q: z.string().describe('Search query to find MCP servers'),
    sort: z
      .enum(['search-relevance:desc', 'popularity:desc', 'recently-added:desc', 'name:asc'])
      .optional()
      .describe('Sort order for results'),
  }),
  output: z.object({
    servers: z.array(mcpServerSummarySchema).describe('Matching MCP servers'),
    stats: directoryStatsSchema.describe('Directory-wide statistics'),
  }),
  handle: async params => {
    const searchParams = new URLSearchParams();
    searchParams.set('q', params.q);
    if (params.sort) {
      searchParams.set('sort', params.sort);
    }

    const data = await navigateAndLoad<SearchRouteData>(
      `/mcp/servers?${searchParams.toString()}`,
      'routes/_public/mcp/servers/_index/_route',
    );

    const servers = (data.serverSearchResult?.results ?? []).map(mapMcpServerSummary);
    const stats = mapDirectoryStats(data.stats ?? {});

    return { servers, stats };
  },
});
