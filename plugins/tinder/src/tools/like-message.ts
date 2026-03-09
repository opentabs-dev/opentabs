import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';

export const likeMessage = defineTool({
  name: 'like_message',
  displayName: 'Like Message',
  description: 'Like a message in a match conversation. This sends a "liked" reaction to the message.',
  summary: 'Like a message',
  icon: 'thumbs-up',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('Message ID to like'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was liked successfully'),
  }),
  handle: async params => {
    await api(`/message/${params.message_id}/like`, {
      method: 'POST',
    });
    return { success: true };
  },
});
