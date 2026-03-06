import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../jira-api.js';

export const linkIssues = defineTool({
  name: 'link_issues',
  displayName: 'Link Issues',
  description:
    'Create a link between two Jira issues. Common link types: "Blocks", "is blocked by", "relates to", "duplicates".',
  summary: 'Link two issues together',
  icon: 'link',
  group: 'Issues',
  input: z.object({
    type: z.string().describe('Link type name (e.g. "Blocks", "is blocked by", "relates to", "duplicates")'),
    inward_issue: z.string().describe('Inward issue key (e.g. "KAN-1")'),
    outward_issue: z.string().describe('Outward issue key (e.g. "KAN-2")'),
  }),
  output: z.object({}),
  handle: async params => {
    await api<Record<string, never>>('/issueLink', {
      method: 'POST',
      body: {
        type: { name: params.type },
        inwardIssue: { key: params.inward_issue },
        outwardIssue: { key: params.outward_issue },
      },
    });
    return {};
  },
});
