import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawMessage, mapMessage, messageSchema } from './schemas.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description: 'Send a message to a match. The match_id is the ID from list_matches.',
  summary: 'Send a message to a match',
  icon: 'send',
  group: 'Messages',
  input: z.object({
    match_id: z.string().describe('Match ID to message'),
    message: z.string().describe('Message text to send'),
  }),
  output: z.object({
    message: messageSchema.describe('The sent message'),
  }),
  handle: async params => {
    const data = await api<RawMessage>(`/user/matches/${params.match_id}`, {
      method: 'POST',
      body: { message: params.message },
    });
    return { message: mapMessage(data) };
  },
});
