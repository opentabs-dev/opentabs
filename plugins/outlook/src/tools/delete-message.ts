import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';

export const deleteMessage = defineTool({
  name: 'delete_message',
  displayName: 'Delete Message',
  description: 'Delete an email message. This moves it to Deleted Items (not permanent deletion).',
  summary: 'Delete an email',
  icon: 'trash-2',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was deleted'),
  }),
  handle: async params => {
    await api(`/me/messages/${params.message_id}`, { method: 'DELETE' });
    return { success: true };
  },
});
