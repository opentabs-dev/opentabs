import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { slackApi } from '../slack-enterprise-api.js';
import { mapReminder, reminderSchema } from './schemas.js';

export const listReminders = defineTool({
  name: 'list_reminders',
  displayName: 'List Reminders',
  description: 'List all reminders for the authenticated user, including pending and completed reminders.',
  summary: 'List user reminders',
  icon: 'bell',
  group: 'Reminders',
  input: z.object({}),
  output: z.object({
    reminders: z.array(reminderSchema),
  }),
  handle: async () => {
    const data = await slackApi<{
      reminders: Array<Record<string, unknown>>;
    }>('reminders.list', {});

    return {
      reminders: (data.reminders ?? []).map(mapReminder),
    };
  },
});
