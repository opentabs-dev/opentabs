import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const createChannel = defineTool({
  name: 'create_channel',
  displayName: 'Create Channel',
  description: 'Create a new channel in a Discord guild (server). Requires Manage Channels permission.',
  summary: 'Create a new channel in a server',
  icon: 'plus-circle',
  group: 'Channels',
  input: z.object({
    guild_id: z.string().min(1).describe('Guild (server) ID to create the channel in'),
    name: z.string().min(1).describe('Channel name (lowercase, hyphens, max 100 chars)'),
    type: z.number().int().optional().describe('Channel type: 0=text (default), 2=voice, 4=category, 5=announcement'),
    topic: z.string().optional().describe('Channel topic (max 1024 chars for text channels)'),
    parent_id: z.string().optional().describe('Parent category ID to nest the channel under'),
    nsfw: z.boolean().optional().describe('Whether the channel is NSFW'),
  }),
  output: z.object({
    channel: channelSchema.describe('The created channel'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = { name: params.name };
    if (params.type !== undefined) body.type = params.type;
    if (params.topic) body.topic = params.topic;
    if (params.parent_id) body.parent_id = params.parent_id;
    if (params.nsfw !== undefined) body.nsfw = params.nsfw;

    const data = await discordApi<Record<string, unknown>>(`/guilds/${params.guild_id}/channels`, {
      method: 'POST',
      body,
    });
    return { channel: mapChannel(data) };
  },
});
