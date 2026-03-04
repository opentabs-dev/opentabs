import { mapPage, pageSchema } from './schemas.js';
import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface SearchResponse {
  results: Array<{ id: string }>;
  total: number;
  recordMap: {
    block?: Record<string, { value?: Record<string, unknown> }>;
  };
}

export const listPages = defineTool({
  name: 'list_pages',
  displayName: 'List Pages',
  description:
    'List all pages in the Notion workspace, sorted by last edited time. Use this to get an overview of workspace content.',
  summary: 'List pages in the workspace',
  icon: 'files',
  group: 'Pages',
  input: z.object({
    limit: z.number().optional().describe('Maximum number of pages to return (default 20, max 100)'),
  }),
  output: z.object({
    pages: z.array(pageSchema).describe('Pages in the workspace'),
    total: z.number().describe('Total number of pages'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const limit = Math.min(params.limit ?? 20, 100);

    const data = await notionApi<SearchResponse>('search', {
      type: 'BlocksInSpace',
      query: '',
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
      sort: { field: 'lastEdited', direction: 'desc' },
      source: 'quick_find',
    });

    const pages = (data.results ?? []).map(r => {
      const block = data.recordMap?.block?.[r.id]?.value;
      return mapPage(block as Record<string, unknown> | undefined);
    });

    return { pages, total: data.total ?? 0 };
  },
});
