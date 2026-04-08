import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const completeReminder = defineTool({
  name: 'complete_reminder',
  displayName: 'Complete Reminder',
  description: 'Mark a Slack reminder as complete. Use list_reminders to find reminder IDs.',
  summary: 'Complete a reminder',
  icon: 'check-circle',
  group: 'Reminders',
  input: z.object({
    reminder: z.string().describe('Reminder ID to mark as complete (from list_reminders)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    await slackApi('reminders.complete', {
      reminder: params.reminder,
    });

    return { success: true };
  },
});
