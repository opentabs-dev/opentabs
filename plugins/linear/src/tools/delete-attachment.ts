import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const deleteAttachment = defineTool({
  name: 'delete_attachment',
  displayName: 'Delete Attachment',
  description: 'Delete an attachment from a Linear issue.',
  summary: 'Delete an attachment',
  icon: 'paperclip',
  group: 'Issues',
  input: z.object({
    attachment_id: z.string().describe('Attachment UUID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the attachment was successfully deleted'),
  }),
  handle: async params => {
    const data = await graphql<{
      attachmentDelete: { success: boolean };
    }>(
      `mutation DeleteAttachment($id: String!) {
        attachmentDelete(id: $id) {
          success
        }
      }`,
      { id: params.attachment_id },
    );

    if (!data.attachmentDelete) throw ToolError.internal('Attachment deletion failed — no response');

    return { success: data.attachmentDelete.success };
  },
});
