import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { MESSAGE_DETAIL_FIELDS, type RawMessage, mapMessageDetail, messageDetailSchema } from './schemas.js';

export const getMessage = defineTool({
  name: 'get_message',
  displayName: 'Get Message',
  description:
    'Get the full content of an email message by ID, including body, all recipients, and metadata. Use list_messages or search_messages to find message IDs.',
  summary: 'Get full email content',
  icon: 'mail-open',
  group: 'Messages',
  input: z.object({
    message_id: z.string().describe('The message ID'),
  }),
  output: z.object({ message: messageDetailSchema }),
  handle: async params => {
    const data = await api<RawMessage>(`/me/messages/${params.message_id}`, {
      query: { $select: MESSAGE_DETAIL_FIELDS },
    });
    return { message: mapMessageDetail(data) };
  },
});
