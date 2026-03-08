import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';

export const approvePullRequest = defineTool({
  name: 'approve_pull_request',
  displayName: 'Approve Pull Request',
  description: 'Approve a pull request as the authenticated user.',
  summary: 'Approve a pull request',
  icon: 'check-circle',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
  }),
  output: z.object({
    approved: z.boolean().describe('Whether the approval was successful'),
  }),
  handle: async params => {
    const data = await api<{ approved?: boolean }>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/approve`,
      { method: 'POST' },
    );
    return { approved: data.approved ?? true };
  },
});
