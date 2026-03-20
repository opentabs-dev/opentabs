import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const forwardMessage = defineTool({
  name: 'forward_message',
  displayName: 'Forward Message',
  description: 'Forward an email message to one or more recipients with an optional comment.',
  summary: 'Forward an email',
  icon: 'forward',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to forward'),
    to: z.array(z.string()).describe('Recipient email addresses'),
    comment: z.string().optional().describe('Optional comment to include above the forwarded message'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was forwarded'),
  }),
  handle: async params => {
    await api(`/me/messages/${params.message_id}/forward`, {
      method: 'POST',
      body: {
        comment: params.comment ?? '',
        toRecipients: params.to.map(addr => ({ emailAddress: { address: addr } })),
      },
    });
    return { success: true };
  },
});
