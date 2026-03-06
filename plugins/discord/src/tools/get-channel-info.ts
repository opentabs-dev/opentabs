import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const getChannelInfo = defineTool({
  name: 'get_channel_info',
  displayName: 'Get Channel Info',
  description: 'Get detailed information about a specific Discord channel',
  summary: 'Get detailed information about a channel',
  icon: 'info',
  group: 'Channels',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to get info for'),
  }),
  output: z.object({
    channel: channelSchema.describe('Channel details'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}`);
    return { channel: mapChannel(data) };
  },
});
