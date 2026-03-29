import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const deleteComment = defineTool({
  name: 'delete_comment',
  displayName: 'Delete Comment',
  description: 'Delete a comment from a Linear issue.',
  summary: 'Delete a comment',
  icon: 'message-square-x',
  group: 'Comments',
  input: z.object({
    comment_id: z.string().describe('Comment UUID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the comment was successfully deleted'),
  }),
  handle: async params => {
    const data = await graphql<{
      commentDelete: { success: boolean };
    }>(
      `mutation DeleteComment($id: String!) {
        commentDelete(id: $id) {
          success
        }
      }`,
      { id: params.comment_id },
    );

    if (!data.commentDelete) throw ToolError.internal('Comment deletion failed — no response');

    return { success: data.commentDelete.success };
  },
});
