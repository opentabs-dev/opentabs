import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachmentSchema, mapAttachment } from './schemas.js';

export const createAttachment = defineTool({
  name: 'create_attachment',
  displayName: 'Create Attachment',
  description: 'Link a URL (PR, document, design file, etc.) to a Linear issue as an attachment.',
  summary: 'Link a URL to an issue',
  icon: 'paperclip',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to attach to'),
    url: z.string().describe('URL to attach (e.g. GitHub PR, Figma file, Google Doc)'),
    title: z.string().describe('Attachment title'),
    subtitle: z.string().optional().describe('Attachment subtitle or description'),
  }),
  output: z.object({
    attachment: attachmentSchema.describe('The newly created attachment'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      issueId: params.issue_id,
      url: params.url,
      title: params.title,
    };
    if (params.subtitle !== undefined) input.subtitle = params.subtitle;

    const data = await graphql<{
      attachmentCreate: {
        success: boolean;
        attachment: Record<string, unknown>;
      };
    }>(
      `mutation CreateAttachment($input: AttachmentCreateInput!) {
        attachmentCreate(input: $input) {
          success
          attachment {
            id title subtitle url sourceType createdAt updatedAt
            creator { name displayName }
          }
        }
      }`,
      { input },
    );

    if (!data.attachmentCreate?.attachment)
      throw ToolError.internal('Attachment creation failed — no attachment returned');

    return {
      attachment: mapAttachment(data.attachmentCreate.attachment as Parameters<typeof mapAttachment>[0]),
    };
  },
});
