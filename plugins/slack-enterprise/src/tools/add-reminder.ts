import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';
import { mapReminder, reminderSchema } from './schemas.js';

export const addReminder = defineTool({
  name: 'add_reminder',
  displayName: 'Add Reminder',
  description:
    'Create a new Slack reminder for the authenticated user. Specify the reminder text and when it should fire as a Unix timestamp.',
  summary: 'Create a reminder',
  icon: 'bell',
  group: 'Reminders',
  input: z.object({
    text: z.string().describe('Reminder text'),
    time: z.number().describe('Unix timestamp when the reminder should fire'),
  }),
  output: z.object({
    reminder: reminderSchema,
  }),
  handle: async params => {
    const data = await slackApi<{
      reminder: Record<string, unknown>;
    }>('reminders.add', {
      text: params.text,
      time: params.time,
    });

    return {
      reminder: mapReminder(data.reminder ?? {}),
    };
  },
});
