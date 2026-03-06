import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawLabel, cursorSchema, extractCursor, labelSchema, mapLabel } from './schemas.js';

export const listLabels = defineTool({
  name: 'list_labels',
  displayName: 'List Labels',
  description: 'List labels attached to a Confluence page',
  summary: 'List labels on a page',
  icon: 'tag',
  group: 'Labels',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to list labels for'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum number of labels to return (default 25, max 200)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    labels: z.array(labelSchema).describe('Array of labels'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawLabel[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/labels`, { query });

    const nextCursor = extractCursor(data._links?.next);
    return {
      labels: (data.results ?? []).map(mapLabel),
      cursor: nextCursor,
    };
  },
});
