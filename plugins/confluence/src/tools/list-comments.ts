import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawComment, commentSchema, cursorSchema, extractCursor, mapComment } from './schemas.js';

export const listComments = defineTool({
  name: 'list_comments',
  displayName: 'List Comments',
  description: 'List footer comments on a Confluence page with optional pagination',
  summary: 'List comments on a page',
  icon: 'message-square',
  group: 'Comments',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to list comments for'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of comments to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
    body_format: z
      .string()
      .optional()
      .describe('Body format to return: "storage" (HTML, default) or "atlas_doc_format" (ADF)'),
  }),
  output: z.object({
    comments: z.array(commentSchema).describe('Array of comments'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
      'body-format': params.body_format ?? 'storage',
    };
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawComment[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/footer-comments`, { query });

    const nextCursor = extractCursor(data._links?.next);
    return {
      comments: (data.results ?? []).map(mapComment),
      cursor: nextCursor,
    };
  },
});
