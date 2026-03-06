import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { channelSchema, mapChannel } from './schemas.js';

export const createThread = defineTool({
  name: 'create_thread',
  displayName: 'Create Thread',
  description:
    'Create a new thread from a message, or a standalone thread in a channel. Threads are temporary sub-channels for focused conversation.',
  summary: 'Create a new thread',
  icon: 'git-branch',
  group: 'Channels',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID to create the thread in'),
    name: z.string().min(1).describe('Thread name (max 100 chars)'),
    message_id: z.string().optional().describe('Message ID to start a thread from (omit for a standalone thread)'),
    auto_archive_duration: z
      .number()
      .int()
      .optional()
      .describe('Minutes of inactivity before auto-archiving: 60, 1440, 4320, or 10080'),
  }),
  output: z.object({
    thread: channelSchema.describe('The created thread channel'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = { name: params.name };
    if (params.auto_archive_duration) {
      body.auto_archive_duration = params.auto_archive_duration;
    }

    let endpoint: string;
    if (params.message_id) {
      // Create thread from a message
      endpoint = `/channels/${params.channel}/messages/${params.message_id}/threads`;
    } else {
      // Create standalone thread (requires type)
      endpoint = `/channels/${params.channel}/threads`;
      body.type = 11; // PUBLIC_THREAD
    }

    const data = await discordApi<Record<string, unknown>>(endpoint, {
      method: 'POST',
      body,
    });
    return { thread: mapChannel(data) };
  },
});
