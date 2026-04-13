import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import {
  type RawInlineComment,
  cursorSchema,
  extractCursor,
  inlineCommentSchema,
  mapInlineComment,
} from './schemas.js';

export const listInlineComments = defineTool({
  name: 'list_inline_comments',
  displayName: 'List Inline Comments',
  description:
    'List inline comments on a Confluence page. Inline comments are anchored to specific text in the page body. Filter by resolution status to see open, resolved, or dangling comments.',
  summary: 'List inline comments on a page',
  icon: 'message-square-text',
  group: 'Comments',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to list inline comments for'),
    resolution_status: z
      .enum(['open', 'resolved', 'dangling', 'reopened'])
      .optional()
      .describe('Filter by resolution status (default: all statuses)'),
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
    comments: z.array(inlineCommentSchema).describe('Array of inline comments'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
      'body-format': params.body_format ?? 'storage',
    };
    if (params.resolution_status) query['resolution-status'] = params.resolution_status;
    if (params.cursor) query.cursor = params.cursor;

    const data = await apiV2<{
      results: RawInlineComment[];
      _links?: { next?: string };
    }>(`/pages/${params.page_id}/inline-comments`, { query });

    return {
      comments: (data.results ?? []).map(mapInlineComment),
      cursor: extractCursor(data._links?.next),
    };
  },
});
