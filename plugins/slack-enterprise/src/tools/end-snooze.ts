import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const endSnooze = defineTool({
  name: 'end_snooze',
  displayName: 'End Do Not Disturb',
  description: 'End the current Do Not Disturb snooze session and resume notifications.',
  summary: 'End snooze and resume notifications',
  icon: 'bell',
  group: 'Do Not Disturb',
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async () => {
    await slackApi('dnd.endSnooze', {});

    return { success: true };
  },
});
