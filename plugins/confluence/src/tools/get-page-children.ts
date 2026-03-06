import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { cursorSchema, extractCursor } from './schemas.js';

const childPageSchema = z.object({
  id: z.string().describe('Child page ID'),
  title: z.string().describe('Child page title'),
  space_id: z.string().describe('Space ID'),
  status: z.string().describe('Page status'),
  position: z.number().describe('Child position within parent'),
});

interface RawChildPage {
  id?: string;
  title?: string;
  spaceId?: string;
  status?: string;
  childPosition?: number;
}

export const getPageChildren = defineTool({
  name: 'get_page_children',
  displayName: 'Get Page Children',
  description: 'List the child pages of a Confluence page. Useful for navigating the page tree.',
  summary: 'List child pages of a page',
  icon: 'folder-tree',
  group: 'Pages',
  input: z.object({
    page_id: z.string().min(1).describe('Parent page ID'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of children to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    children: z.array(childPageSchema).describe('Array of child pages'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawChildPage[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/children`, { query });

    const nextCursor = extractCursor(data._links?.next);
    return {
      children: (data.results ?? []).map(c => ({
        id: c.id ?? '',
        title: c.title ?? '',
        space_id: c.spaceId ?? '',
        status: c.status ?? '',
        position: c.childPosition ?? 0,
      })),
      cursor: nextCursor,
    };
  },
});
