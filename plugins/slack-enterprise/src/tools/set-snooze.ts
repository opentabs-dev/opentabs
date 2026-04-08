import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const setSnooze = defineTool({
  name: 'set_snooze',
  displayName: 'Set Do Not Disturb',
  description: 'Enable Do Not Disturb mode for the specified number of minutes. Pauses all notifications.',
  summary: 'Snooze notifications',
  icon: 'bell-off',
  group: 'Do Not Disturb',
  input: z.object({
    num_minutes: z.number().describe('Number of minutes to snooze notifications'),
  }),
  output: z.object({
    snooze_enabled: z.boolean(),
    snooze_endtime: z.number().describe('Unix timestamp when snooze ends'),
    snooze_remaining: z.number().describe('Seconds remaining in snooze'),
  }),
  handle: async params => {
    const data = await slackApi<{
      snooze_enabled: boolean;
      snooze_endtime: number;
      snooze_remaining: number;
    }>('dnd.setSnooze', {
      num_minutes: params.num_minutes,
    });

    return {
      snooze_enabled: data.snooze_enabled ?? true,
      snooze_endtime: data.snooze_endtime ?? 0,
      snooze_remaining: data.snooze_remaining ?? 0,
    };
  },
});
