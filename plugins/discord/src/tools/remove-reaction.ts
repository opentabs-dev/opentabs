import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';

export const removeReaction = defineTool({
  name: 'remove_reaction',
  displayName: 'Remove Reaction',
  description: 'Remove your emoji reaction from a message',
  summary: 'Remove an emoji reaction from a message',
  icon: 'frown',
  group: 'Reactions',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID where the message is located'),
    message_id: z.string().min(1).describe('Message ID to remove reaction from'),
    emoji: z
      .string()
      .min(1)
      .describe('Emoji to remove — use Unicode emoji (e.g., "👍") or custom emoji format "name:id"'),
  }),
  output: z.object({}),
  handle: async params => {
    const emoji = encodeURIComponent(params.emoji);
    await discordApi(`/channels/${params.channel}/messages/${params.message_id}/reactions/${emoji}/@me`, {
      method: 'DELETE',
    });
    return {};
  },
});
