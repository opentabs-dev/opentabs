import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const getMessage = defineTool({
  name: 'get_message',
  displayName: 'Get Message',
  description: 'Get a specific message by its ID from a Discord channel.',
  summary: 'Get a message by ID',
  icon: 'message-square',
  group: 'Messages',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID where the message is located'),
    message_id: z.string().min(1).describe('ID of the message to retrieve'),
  }),
  output: z.object({
    message: messageSchema.describe('The requested message'),
  }),
  handle: async params => {
    // The single-message endpoint (GET /channels/{id}/messages/{id}) is bot-only.
    // Use the list-messages endpoint with around + limit=1 to fetch a specific message.
    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}/messages`, {
      query: { around: params.message_id, limit: 3 },
    });
    const arr = Array.isArray(data) ? data : [];
    const target = arr.find((m: Record<string, unknown>) => m.id === params.message_id);
    if (!target) {
      throw ToolError.notFound(`Message ${params.message_id} not found in channel ${params.channel}`);
    }
    return { message: mapMessage(target) };
  },
});
