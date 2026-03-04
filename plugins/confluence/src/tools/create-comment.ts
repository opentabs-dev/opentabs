import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';
import { type RawComment, commentSchema, mapComment } from './schemas.js';

export const createComment = defineTool({
  name: 'create_comment',
  displayName: 'Create Comment',
  description: 'Add a footer comment to a Confluence page. The comment body uses storage format (HTML).',
  summary: 'Add a comment to a page',
  icon: 'message-square-plus',
  group: 'Comments',
  input: z.object({
    page_id: z.string().min(1).describe('Page ID to comment on'),
    body: z.string().min(1).describe('Comment body in storage format (HTML) — e.g., "<p>Great work!</p>"'),
  }),
  output: z.object({
    comment: commentSchema.describe('The created comment'),
  }),
  handle: async params => {
    const data = await apiV2<RawComment>('/footer-comments', {
      method: 'POST',
      body: {
        pageId: params.page_id,
        body: {
          representation: 'storage',
          value: params.body,
        },
      },
    });

    return { comment: mapComment(data) };
  },
});
