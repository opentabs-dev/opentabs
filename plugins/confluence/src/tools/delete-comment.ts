import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV2 } from '../confluence-api.js';

export const deleteComment = defineTool({
  name: 'delete_comment',
  displayName: 'Delete Comment',
  description: 'Delete a footer comment from a Confluence page. The comment is permanently removed.',
  summary: 'Delete a comment from a page',
  icon: 'message-square-x',
  group: 'Comments',
  input: z.object({
    comment_id: z.string().min(1).describe('Comment ID to delete'),
  }),
  output: z.object({
    deleted: z.boolean().describe('Whether the comment was deleted'),
  }),
  handle: async params => {
    await apiV2<unknown>(`/footer-comments/${params.comment_id}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  },
});
