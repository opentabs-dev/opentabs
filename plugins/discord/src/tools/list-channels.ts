import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const listChannels = defineTool({
  name: 'list_channels',
  displayName: 'List Channels',
  description: 'List all channels in a Discord guild (server)',
  summary: 'List channels in a server',
  icon: 'hash',
  group: 'Channels',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to list channels for'),
  }),
  output: z.object({
    channels: z.array(channelSchema).describe('List of channels'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/guilds/${params.guild_id}/channels`);
    const channels = Array.isArray(data) ? (data as Record<string, unknown>[]).map(c => mapChannel(c)) : [];
    return { channels };
  },
});
