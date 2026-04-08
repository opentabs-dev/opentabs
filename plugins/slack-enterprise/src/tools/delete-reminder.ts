import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';

export const deleteReminder = defineTool({
  name: 'delete_reminder',
  displayName: 'Delete Reminder',
  description: 'Delete a Slack reminder. Use list_reminders to find reminder IDs.',
  summary: 'Delete a reminder',
  icon: 'bell-off',
  group: 'Reminders',
  input: z.object({
    reminder: z.string().describe('Reminder ID to delete (from list_reminders)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    await slackApi('reminders.delete', {
      reminder: params.reminder,
    });

    return { success: true };
  },
});
