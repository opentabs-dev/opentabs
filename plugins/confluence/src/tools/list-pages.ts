import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawPage, cursorSchema, mapPage, pageSchema } from './schemas.js';

export const listPages = defineTool({
  name: 'list_pages',
  displayName: 'List Pages',
  description:
    'List Confluence pages. Optionally filter by space ID and sort by modified date. Returns paginated results.',
  summary: 'List pages in a space',
  icon: 'files',
  group: 'Pages',
  input: z.object({
    space_id: z.string().optional().describe('Filter pages by space ID — omit to list pages across all spaces'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of pages to return (default 25, max 250)'),
    sort: z
      .string()
      .optional()
      .describe('Sort order (e.g., "-modified-date" for most recent first, "title" for alphabetical)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    pages: z.array(pageSchema).describe('Array of pages'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.sort) query.sort = params.sort;
    if (params.cursor) query.cursor = params.cursor;

    const endpoint = params.space_id ? `/spaces/${params.space_id}/pages` : '/pages';
    const data = await apiV2<{
      results: RawPage[];
      _links?: { next?: string };
    }>(endpoint, { query });

    const nextCursor = extractCursor(data._links?.next);
    return {
      pages: (data.results ?? []).map(mapPage),
      cursor: nextCursor,
    };
  },
});

function extractCursor(nextUrl?: string): string | null {
  if (!nextUrl) return null;
  try {
    const url = new URL(nextUrl, 'https://placeholder.com');
    return url.searchParams.get('cursor');
  } catch {
    return null;
  }
}
