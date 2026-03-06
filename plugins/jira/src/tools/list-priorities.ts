import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

const prioritySchema = z.object({
  id: z.string().describe('Priority ID'),
  name: z.string().describe('Priority name (e.g. Highest, High, Medium, Low, Lowest)'),
  description: z.string().describe('Priority description'),
});

interface JiraPriority {
  id?: string;
  name?: string;
  description?: string;
}

export const listPriorities = defineTool({
  name: 'list_priorities',
  displayName: 'List Priorities',
  description:
    'List available priority levels for the Jira instance. Use this to find valid priority names for create_issue and update_issue.',
  summary: 'List available priorities',
  icon: 'arrow-up-down',
  group: 'Issues',
  input: z.object({}),
  output: z.object({
    priorities: z.array(prioritySchema).describe('Available priority levels'),
  }),
  handle: async () => {
    const data = await api<Record<string, unknown>[]>('/priority');
    return {
      priorities: data.map(item => {
        const p = item as unknown as JiraPriority;
        return {
          id: p.id ?? '',
          name: p.name ?? '',
          description: p.description ?? '',
        };
      }),
    };
  },
});
