import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const getDndStatus = defineTool({
  name: 'get_dnd_status',
  displayName: 'Get DND Status',
  description:
    'Get the current Do Not Disturb status for the authenticated user, including scheduled DND times and active snooze status.',
  summary: 'Get Do Not Disturb status',
  icon: 'bell',
  group: 'Do Not Disturb',
  input: z.object({}),
  output: z.object({
    dnd_enabled: z.boolean().describe('Whether DND is enabled'),
    next_dnd_start_ts: z.number().describe('Unix timestamp when next DND period starts'),
    next_dnd_end_ts: z.number().describe('Unix timestamp when next DND period ends'),
    snooze_enabled: z.boolean().describe('Whether snooze is currently active'),
    snooze_endtime: z.number().describe('Unix timestamp when snooze ends (0 if not snoozing)'),
    snooze_remaining: z.number().describe('Seconds remaining in snooze (0 if not snoozing)'),
  }),
  handle: async () => {
    const data = await slackApi<{
      dnd_enabled: boolean;
      next_dnd_start_ts: number;
      next_dnd_end_ts: number;
      snooze_enabled: boolean;
      snooze_endtime: number;
      snooze_remaining: number;
    }>('dnd.info', {});

    return {
      dnd_enabled: data.dnd_enabled ?? false,
      next_dnd_start_ts: data.next_dnd_start_ts ?? 0,
      next_dnd_end_ts: data.next_dnd_end_ts ?? 0,
      snooze_enabled: data.snooze_enabled ?? false,
      snooze_endtime: data.snooze_endtime ?? 0,
      snooze_remaining: data.snooze_remaining ?? 0,
    };
  },
});
