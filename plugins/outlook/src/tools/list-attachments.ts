import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { type RawAttachment, attachmentSchema, mapAttachment } from './schemas.js';

export const listAttachments = defineTool({
  name: 'list_attachments',
  displayName: 'List Attachments',
  description: 'List attachments on an email message. Returns file names, types, and sizes.',
  summary: 'List email attachments',
  icon: 'paperclip',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID'),
  }),
  output: z.object({
    attachments: z.array(attachmentSchema).describe('Message attachments'),
  }),
  handle: async params => {
    const data = await api<{ value: RawAttachment[] }>(`/me/messages/${params.message_id}/attachments`, {
      query: { $select: 'id,name,contentType,size,isInline' },
    });
    return { attachments: (data.value ?? []).map(mapAttachment) };
  },
});
