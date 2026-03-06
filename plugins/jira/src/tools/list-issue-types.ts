import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

const issueTypeSchema = z.object({
  id: z.string().describe('Issue type ID'),
  name: z.string().describe('Issue type name (e.g. Task, Story, Bug, Epic)'),
  description: z.string().describe('Issue type description'),
  subtask: z.boolean().describe('Whether this is a subtask type'),
});

interface JiraIssueType {
  id?: string;
  name?: string;
  description?: string;
  subtask?: boolean;
}

export const listIssueTypes = defineTool({
  name: 'list_issue_types',
  displayName: 'List Issue Types',
  description:
    'List available issue types for the Jira instance. Use this to find valid issue type names for create_issue.',
  summary: 'List available issue types',
  icon: 'list',
  group: 'Issues',
  input: z.object({}),
  output: z.object({
    issue_types: z.array(issueTypeSchema).describe('Available issue types'),
  }),
  handle: async () => {
    const data = await api<Record<string, unknown>[]>('/issuetype');
    return {
      issue_types: data.map(item => {
        const t = item as unknown as JiraIssueType;
        return {
          id: t.id ?? '',
          name: t.name ?? '',
          description: t.description ?? '',
          subtask: t.subtask ?? false,
        };
      }),
    };
  },
});
