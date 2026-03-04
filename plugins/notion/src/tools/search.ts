import { mapPage, pageSchema } from './schemas.js';
import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface SearchResponse {
  results: Array<{ id: string; score: number; highlight?: Record<string, string> }>;
  total: number;
  recordMap: {
    block?: Record<string, { value?: Record<string, unknown> }>;
  };
}

export const search = defineTool({
  name: 'search',
  displayName: 'Search',
  description: 'Search for pages and blocks in the Notion workspace by text query',
  summary: 'Search pages and blocks',
  icon: 'search',
  group: 'Pages',
  input: z.object({
    query: z.string().describe('Search query text'),
    limit: z.number().optional().describe('Maximum number of results to return (default 10, max 100)'),
  }),
  output: z.object({
    total: z.number().describe('Total number of matching results'),
    pages: z.array(pageSchema).describe('Matching pages'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const limit = Math.min(params.limit ?? 10, 100);

    const data = await notionApi<SearchResponse>('search', {
      type: 'BlocksInSpace',
      query: params.query,
      spaceId,
      limit,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: true,
        navigableBlockContentOnly: true,
        requireEditPermissions: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        inTeams: [],
      },
      sort: { field: 'relevance', direction: 'desc' },
      source: 'quick_find',
    });

    const pages = (data.results ?? []).map(r => {
      const block = data.recordMap?.block?.[r.id]?.value;
      return mapPage(block as Record<string, unknown> | undefined);
    });

    return { total: data.total ?? 0, pages };
  },
});
