import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const deleteChannel = defineTool({
  name: 'delete_channel',
  displayName: 'Delete Channel',
  description: 'Delete a Discord channel. This action is permanent and cannot be undone.',
  summary: 'Delete a channel permanently',
  icon: 'trash-2',
  group: 'Channels',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to delete'),
  }),
  output: z.object({
    channel: channelSchema.describe('The deleted channel'),
  }),
  handle: async params => {
    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}`, {
      method: 'DELETE',
    });
    return { channel: mapChannel(data) };
  },
});
