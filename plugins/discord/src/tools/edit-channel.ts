import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const editChannel = defineTool({
  name: 'edit_channel',
  displayName: 'Edit Channel',
  description: 'Edit a Discord channel. Update name, topic, NSFW flag, or move to a different category.',
  summary: "Edit a channel's name, topic, or settings",
  icon: 'edit',
  group: 'Channels',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to edit'),
    name: z.string().optional().describe('New channel name (lowercase, hyphens, max 100 chars)'),
    topic: z.string().optional().describe('New channel topic (max 1024 chars for text channels)'),
    nsfw: z.boolean().optional().describe('Whether the channel is NSFW'),
    parent_id: z.string().optional().describe('Parent category ID to move the channel under'),
  }),
  output: z.object({
    channel: channelSchema.describe('The updated channel'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.topic !== undefined) body.topic = params.topic;
    if (params.nsfw !== undefined) body.nsfw = params.nsfw;
    if (params.parent_id !== undefined) body.parent_id = params.parent_id;

    const data = await discordApi<Record<string, unknown>>(`/channels/${params.channel}`, {
      method: 'PATCH',
      body,
    });
    return { channel: mapChannel(data) };
  },
});
