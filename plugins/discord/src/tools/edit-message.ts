import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const editMessage = defineTool({
  name: 'edit_message',
  displayName: 'Edit Message',
  description: 'Edit an existing message. Only messages sent by the authenticated user can be edited.',
  summary: 'Edit an existing message',
  icon: 'pencil',
  group: 'Messages',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID where the message is located'),
    message_id: z.string().min(1).describe('ID of the message to edit'),
    content: z.string().min(1).describe('New message text content'),
  }),
  output: z.object({
    message: messageSchema.describe('The edited message'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(
      `/channels/${params.channel}/messages/${params.message_id}`,
      { method: 'PATCH', body: { content: params.content } },
    );
    return { message: mapMessage(data) };
  },
});
