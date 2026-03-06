import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const readMessages = defineTool({
  name: 'read_messages',
  displayName: 'Read Messages',
  description: 'Read recent messages from a Discord channel with optional pagination',
  summary: 'Read recent messages from a channel',
  icon: 'message-square',
  group: 'Messages',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to read messages from'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of messages to return (default 50, max 100)'),
    before: z.string().optional().describe('Get messages before this message ID (for pagination)'),
    after: z.string().optional().describe('Get messages after this message ID'),
    around: z.string().optional().describe('Get messages around this message ID'),
  }),
  output: z.object({
    messages: z.array(messageSchema).describe('List of messages (newest first)'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 50,
    };
    if (params.before) query.before = params.before;
    if (params.after) query.after = params.after;
    if (params.around) query.around = params.around;

    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}/messages`, { query });
    const messages = Array.isArray(data) ? (data as Record<string, unknown>[]).map(m => mapMessage(m)) : [];
    return { messages };
  },
});
