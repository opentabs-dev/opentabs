import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi, slackEnterpriseApi } from '../slack-enterprise-api.js';
import { mapStarredItem, starredItemSchema } from './schemas.js';

export const listStars = defineTool({
  name: 'list_stars',
  displayName: 'List Stars',
  description:
    'List all starred/saved items for the authenticated user. On Enterprise Grid, tries the modern saved.list API first, then falls back to stars.list.',
  summary: 'List starred/saved items',
  icon: 'star',
  group: 'Stars',
  input: z.object({
    count: z.number().optional().default(50).describe('Number of items to return (default 50, max 1000)'),
    cursor: z.string().optional().describe('Pagination cursor for next page'),
  }),
  output: z.object({
    items: z.array(starredItemSchema),
    has_more: z.boolean(),
  }),
  handle: async params => {
    // Try saved.list (enterprise API) first
    try {
      const data = await slackEnterpriseApi<{
        items: Array<Record<string, unknown>>;
        response_metadata?: { next_cursor?: string };
      }>('saved.list', {
        limit: Math.min(params.count ?? 50, 50),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      });
      return {
        items: (data.items ?? []).map(mapStarredItem),
        has_more: !!data.response_metadata?.next_cursor,
      };
    } catch (error) {
      if (error instanceof ToolError && (error.category === 'auth' || error.category === 'rate_limit')) {
        throw error;
      }
      // Fall back to stars.list (workspace API)
    }

    const apiParams: Record<string, unknown> = {
      count: Math.min(params.count ?? 50, 1000),
    };
    if (params.cursor) apiParams.cursor = params.cursor;

    const data = await slackApi<{
      items: Array<Record<string, unknown>>;
      paging?: { pages: number; page: number };
    }>('stars.list', apiParams);

    const paging = data.paging;
    return {
      items: (data.items ?? []).map(mapStarredItem),
      has_more: paging ? paging.page < paging.pages : false,
    };
  },
});
