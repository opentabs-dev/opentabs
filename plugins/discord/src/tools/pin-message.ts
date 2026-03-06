import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';

export const pinMessage = defineTool({
  name: 'pin_message',
  displayName: 'Pin Message',
  description: 'Pin a message in a channel. Requires Manage Messages permission.',
  summary: 'Pin a message in a channel',
  icon: 'pin',
  group: 'Reactions',
  input: z.object({
    channel: z.string().min(1).describe('Channel ID where the message is located'),
    message_id: z.string().min(1).describe('Message ID to pin'),
  }),
  output: z.object({}),
  handle: async params => {
    await discordApi(`/channels/${params.channel}/pins/${params.message_id}`, {
      method: 'PUT',
    });
    return {};
  },
});
