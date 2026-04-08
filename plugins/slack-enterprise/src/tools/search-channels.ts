import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackEnterpriseApi } from '../slack-enterprise-api.js';
import { mapSearchChannel, searchChannelSchema } from './schemas.js';

export const searchChannels = defineTool({
  name: 'search_channels',
  displayName: 'Search Channels',
  description:
    'Search for channels by name in the Slack workspace. Returns matching channels sorted by recent activity. Useful for finding channels by name pattern (e.g., "incident" to find all incident channels).',
  summary: 'Search channels by name',
  icon: 'hash',
  group: 'Search',
  input: z.object({
    query: z.string().describe('Search query to match against channel names'),
    count: z.number().optional().default(20).describe('Number of results to return per page (default 20, max 100)'),
    page: z.number().optional().default(1).describe('Page number of results to return (default 1)'),
  }),
  output: z.object({
    channels: z.array(searchChannelSchema),
    total: z.number(),
    page: z.number(),
    pages: z.number(),
  }),
  handle: async params => {
    const data = await slackEnterpriseApi<{
      items: Record<string, Record<string, unknown>>;
      pagination: { total_count: number; page: number; page_count: number; per_page: number };
    }>('search.modules', {
      query: params.query,
      module: 'channels',
      count: Math.min(params.count ?? 20, 100),
      page: params.page ?? 1,
    });

    const items = data.items ?? {};
    const channels = Object.values(items).map(mapSearchChannel);
    const pagination = data.pagination ?? { total_count: 0, page: 1, page_count: 1 };

    return {
      channels,
      total: pagination.total_count ?? 0,
      page: pagination.page ?? 1,
      pages: pagination.page_count ?? 1,
    };
  },
});
