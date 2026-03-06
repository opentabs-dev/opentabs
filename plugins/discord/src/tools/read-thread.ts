import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';
import { mapMessage, messageSchema } from './schemas.js';

export const readThread = defineTool({
  name: 'read_thread',
  displayName: 'Read Thread',
  description:
    'Read messages from a thread. Threads are channels, so this works the same as read_messages but is semantically specific to threads.',
  summary: 'Read messages from a thread',
  icon: 'git-branch',
  group: 'Messages',
  input: z.object({
    thread_id: z.string().min(1).describe('Thread (channel) ID to read messages from'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of messages to return (default 50, max 100)'),
    before: z.string().optional().describe('Get messages before this message ID (for pagination)'),
    after: z.string().optional().describe('Get messages after this message ID'),
  }),
  output: z.object({
    messages: z.array(messageSchema).describe('List of thread messages (newest first)'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      limit: params.limit ?? 50,
    };
    if (params.before) query.before = params.before;
    if (params.after) query.after = params.after;

    const data = await discordApi<Record<string, unknown>>(`/channels/${params.thread_id}/messages`, { query });
    const messages = Array.isArray(data) ? (data as Record<string, unknown>[]).map(m => mapMessage(m)) : [];
    return { messages };
  },
});
