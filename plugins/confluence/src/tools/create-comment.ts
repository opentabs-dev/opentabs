import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawComment, commentSchema, mapComment } from './schemas.js';

export const createComment = defineTool({
  name: 'create_comment',
  displayName: 'Create Comment',
  description:
    'Add a footer comment to a Confluence page, or reply to an existing comment. To create a new top-level comment, provide page_id. To reply to an existing footer comment, provide parent_comment_id instead. The comment body uses storage format (HTML).',
  summary: 'Add a footer comment or reply to a comment',
  icon: 'message-square-plus',
  group: 'Comments',
  input: z.object({
    page_id: z
      .string()
      .min(1)
      .optional()
      .describe('Page ID to comment on — required for new top-level comments, omit when replying'),
    parent_comment_id: z
      .string()
      .min(1)
      .optional()
      .describe('Parent footer comment ID to reply to — omit for new top-level comments'),
    body: z.string().min(1).describe('Comment body in storage format (HTML) — e.g., "<p>Great work!</p>"'),
  }),
  output: z.object({
    comment: commentSchema.describe('The created comment'),
  }),
  handle: async params => {
    if (!params.page_id && !params.parent_comment_id) {
      throw ToolError.validation('Either page_id (for new comments) or parent_comment_id (for replies) is required.');
    }
    if (params.page_id && params.parent_comment_id) {
      throw ToolError.validation(
        'Provide either page_id or parent_comment_id, not both. Use page_id for new top-level comments, parent_comment_id for replies.',
      );
    }

    const requestBody: Record<string, unknown> = {
      body: {
        representation: 'storage',
        value: params.body,
      },
    };

    if (params.parent_comment_id) {
      requestBody.parentCommentId = params.parent_comment_id;
    } else {
      requestBody.pageId = params.page_id;
    }

    const data = await apiV2<RawComment>('/footer-comments', {
      method: 'POST',
      body: requestBody,
    });

    return { comment: mapComment(data) };
  },
});
