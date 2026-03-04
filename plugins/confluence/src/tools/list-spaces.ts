import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawSpace, cursorSchema, mapSpace, spaceSchema } from './schemas.js';

export const listSpaces = defineTool({
  name: 'list_spaces',
  displayName: 'List Spaces',
  description: 'List Confluence spaces with optional pagination',
  summary: 'List available spaces',
  icon: 'layout-grid',
  group: 'Spaces',
  input: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of spaces to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    spaces: z.array(spaceSchema).describe('Array of spaces'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawSpace[];
      _links?: { next?: string };
    }>('/spaces', { query });

    const nextCursor = extractCursor(data._links?.next);
    return {
      spaces: (data.results ?? []).map(mapSpace),
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
