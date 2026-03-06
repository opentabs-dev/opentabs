import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const listPinnedMessages = defineTool({
  name: 'list_pinned_messages',
  displayName: 'List Pinned Messages',
  description: 'List all pinned messages in a Discord channel. Returns messages in reverse chronological order.',
  summary: 'List pinned messages in a channel',
  icon: 'pin',
  group: 'Messages',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to list pinned messages for'),
  }),
  output: z.object({
    messages: z.array(messageSchema).describe('List of pinned messages'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}/pins`);
    const messages = Array.isArray(data) ? (data as Record<string, unknown>[]).map(m => mapMessage(m)) : [];
    return { messages };
  },
});
