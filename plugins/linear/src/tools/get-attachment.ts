import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachmentSchema, mapAttachment } from './schemas.js';

export const getAttachment = defineTool({
  name: 'get_attachment',
  displayName: 'Get Attachment',
  description: 'Get detailed information about a single attachment by its UUID.',
  summary: 'Get details of a single attachment',
  icon: 'paperclip',
  group: 'Issues',
  input: z.object({
    attachment_id: z.string().describe('Attachment UUID'),
  }),
  output: z.object({
    attachment: attachmentSchema.describe('The requested attachment'),
  }),
  handle: async params => {
    const data = await graphql<{ attachment: Record<string, unknown> }>(
      `query GetAttachment($id: String!) {
        attachment(id: $id) {
          id title subtitle url sourceType createdAt updatedAt
          creator { name displayName }
        }
      }`,
      { id: params.attachment_id },
    );

    if (!data.attachment) throw ToolError.notFound('Attachment not found');

    return { attachment: mapAttachment(data.attachment as Parameters<typeof mapAttachment>[0]) };
  },
});
