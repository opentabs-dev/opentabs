import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const setStatus = defineTool({
  name: 'set_status',
  displayName: 'Set Status',
  description:
    "Update the current authenticated user's status text and emoji. Pass empty strings to clear the status. Optionally set an expiration time.",
  summary: 'Set user status',
  icon: 'smile',
  group: 'Profile',
  input: z.object({
    status_text: z.string().describe('Status message text (empty string to clear)'),
    status_emoji: z.string().describe('Status emoji (e.g., ":house:" for WFH, empty string to clear)'),
    status_expiration: z.number().optional().describe('Unix timestamp when the status expires (0 for no expiration)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    const profile: Record<string, unknown> = {
      status_text: params.status_text,
      status_emoji: params.status_emoji,
      status_expiration: params.status_expiration ?? 0,
    };

    await slackApi('users.profile.set', {
      profile: JSON.stringify(profile),
    });

    return { success: true };
  },
});
