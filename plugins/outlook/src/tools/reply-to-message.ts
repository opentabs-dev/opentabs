import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const replyToMessage = defineTool({
  name: 'reply_to_message',
  displayName: 'Reply to Message',
  description: 'Reply to an email message. Set reply_all to true to reply to all recipients.',
  summary: 'Reply to an email',
  icon: 'reply',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to reply to'),
    body: z.string().describe('Reply body content'),
    body_type: z.enum(['text', 'html']).optional().describe('Body content type (default: text)'),
    reply_all: z.boolean().optional().describe('Reply to all recipients (default: false)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was sent'),
  }),
  handle: async params => {
    const action = params.reply_all ? 'replyAll' : 'reply';
    await api(`/me/messages/${params.message_id}/${action}`, {
      method: 'POST',
      body:
        params.body_type === 'html'
          ? {
              message: {
                body: { contentType: 'HTML', content: params.body },
              },
            }
          : { comment: params.body },
    });
    return { success: true };
  },
});
