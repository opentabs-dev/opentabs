import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawComment, commentSchema, cursorSchema, extractCursor, mapComment } from './schemas.js';

export const listCommentReplies = defineTool({
  name: 'list_comment_replies',
  displayName: 'List Comment Replies',
  description:
    'List replies (child comments) on a Confluence comment. Works for both inline and footer comments. Specify the comment type to use the correct API endpoint.',
  summary: 'List replies to a comment',
  icon: 'messages-square',
  group: 'Comments',
  input: z.object({
    comment_id: z.string().min(1).describe('Parent comment ID to list replies for'),
    comment_type: z.enum(['inline', 'footer']).describe('Type of the parent comment: "inline" or "footer"'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(250)
      .optional()
      .describe('Maximum number of replies to return (default 25, max 250)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response'),
    body_format: z
      .string()
      .optional()
      .describe('Body format to return: "storage" (HTML, default) or "atlas_doc_format" (ADF)'),
  }),
  output: z.object({
    replies: z.array(commentSchema).describe('Array of reply comments'),
    cursor: cursorSchema,
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 25,
      'body-format': params.body_format ?? 'storage',
    };
    if (params.cursor) query.cursor = params.cursor;

    const endpoint = `/${params.comment_type}-comments/${params.comment_id}/children`;
    const data = await apiV2<{
      results: RawComment[];
      _links?: { next?: string };
    }>(endpoint, { query });

    return {
      replies: (data.results ?? []).map(mapComment),
      cursor: extractCursor(data._links?.next),
    };
  },
});
