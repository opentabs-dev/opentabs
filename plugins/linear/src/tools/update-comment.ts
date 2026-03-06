import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { commentSchema, mapComment } from './schemas.js';

export const updateComment = defineTool({
  name: 'update_comment',
  displayName: 'Update Comment',
  description: 'Update an existing comment on a Linear issue.',
  summary: 'Update a comment',
  icon: 'message-square',
  group: 'Comments',
  input: z.object({
    comment_id: z.string().describe('Comment UUID to update'),
    body: z.string().describe('New comment body in markdown'),
  }),
  output: z.object({
    comment: commentSchema.describe('The updated comment'),
  }),
  handle: async params => {
    const data = await graphql<{
      commentUpdate: {
        success: boolean;
        comment: Record<string, unknown>;
      };
    }>(
      `mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) {
          success
          comment {
            id body createdAt updatedAt editedAt
            user { name displayName }
          }
        }
      }`,
      { id: params.comment_id, input: { body: params.body } },
    );

    if (!data.commentUpdate?.success) throw ToolError.internal('Comment update failed');
    if (!data.commentUpdate.comment) throw ToolError.internal('Comment update failed — no comment returned');

    return { comment: mapComment(data.commentUpdate.comment as Parameters<typeof mapComment>[0]) };
  },
});
