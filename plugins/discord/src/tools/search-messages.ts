import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const searchMessages = defineTool({
  name: 'search_messages',
  displayName: 'Search Messages',
  description:
    'Search for messages in a guild. Supports content queries and filters like from:, in:, has:, before:, after:',
  summary: 'Search messages in a server',
  icon: 'search',
  group: 'Messages',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to search in'),
    content: z.string().optional().describe('Text content to search for'),
    author_id: z.string().optional().describe('Filter by author user ID'),
    channel_id: z.string().optional().describe('Filter by channel ID'),
    has: z.string().optional().describe('Filter by attachment type: link, embed, file, video, image, sound, sticker'),
    limit: z.number().int().min(1).max(25).optional().describe('Number of results (default 25, max 25)'),
    offset: z.number().int().min(0).optional().describe('Result offset for pagination'),
  }),
  output: z.object({
    total_results: z.number().describe('Total number of matching messages'),
    messages: z.array(z.array(messageSchema)).describe('Search results grouped by context'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.content) query.content = params.content;
    if (params.author_id) query.author_id = params.author_id;
    if (params.channel_id) query.channel_id = params.channel_id;
    if (params.has) query.has = params.has;
    if (params.limit) query.limit = params.limit;
    if (params.offset) query.offset = params.offset;

    const data = await discordApi<{
      total_results: number;
      messages: Record<string, unknown>[][];
    }>(`/guilds/${params.guild_id}/messages/search`, { query });

    return {
      total_results: data.total_results ?? 0,
      messages: (data.messages ?? []).map(group => group.map(m => mapMessage(m))),
    };
  },
});
