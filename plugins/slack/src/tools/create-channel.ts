import { slackApi } from '../slack-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const createChannel = defineTool({
  name: 'create_channel',
  displayName: 'Create Channel',
  description: 'Create a new public or private Slack channel',
  icon: 'plus-circle',
  input: z.object({
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Channel name must be lowercase alphanumeric with hyphens/underscores')
      .describe('Name for the new channel — must be lowercase, no spaces, max 80 chars (e.g., "project-updates")'),
    is_private: z
      .boolean()
      .optional()
      .describe('Whether to create a private channel (default false — creates public channel)'),
    topic: z.string().min(1).max(250).optional().describe('Initial topic for the channel (max 250 chars)'),
  }),
  output: z.object({
    channel: z
      .object({
        id: z.string().describe('ID of the newly created channel'),
        name: z.string().describe('Name of the created channel'),
        is_private: z.boolean().describe('Whether the channel is private'),
      })
      .describe('The newly created channel'),
    warning: z.string().optional().describe('Warning message if the channel was created but setting the topic failed'),
  }),
  handle: async params => {
    const data = await slackApi<{
      channel: { id?: string; name?: string; is_private?: boolean };
    }>('conversations.create', {
      name: params.name,
      is_private: params.is_private ?? false,
    });

    let warning: string | undefined;
    if (params.topic) {
      if (!data.channel.id) {
        warning = 'Channel created but could not set topic: missing channel ID in API response';
      } else {
        try {
          await slackApi('conversations.setTopic', { channel: data.channel.id, topic: params.topic });
        } catch (err) {
          warning = `Channel created but failed to set topic: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    return {
      channel: {
        id: data.channel.id ?? '',
        name: data.channel.name ?? '',
        is_private: data.channel.is_private ?? false,
      },
      warning,
    };
  },
});
