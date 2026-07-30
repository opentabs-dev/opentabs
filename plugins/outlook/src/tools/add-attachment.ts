import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { attachToDraft, attachmentInputSchema } from '../attachments.js';

export const addAttachment = defineTool({
  name: 'add_attachment',
  displayName: 'Add Attachment',
  description:
    'Attach one or more files to an existing draft message (created by create_draft, or a reply/forward saved with draft set to true). Files are provided as base64-encoded content. Attachments can only be added to drafts — not to already-sent messages.',
  summary: 'Attach files to a draft',
  icon: 'paperclip',
  group: 'Messages',
  input: z.object({
    draft_id: z.string().min(1).describe('The draft message ID to attach the files to'),
    attachments: z.array(attachmentInputSchema).min(1).describe('The files to attach'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the files were attached'),
    attached_count: z.number().describe('Number of files attached'),
  }),
  handle: async params => {
    await attachToDraft(params.draft_id, params.attachments);
    return { success: true, attached_count: params.attachments.length };
  },
});
