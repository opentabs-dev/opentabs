import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const declinePullRequest = defineTool({
  name: 'decline_pull_request',
  displayName: 'Decline Pull Request',
  description: 'Decline a pull request, marking it as rejected.',
  summary: 'Decline a pull request',
  icon: 'x-circle',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
  }),
  output: pullRequestSchema,
  handle: async params => {
    const data = await api<RawPR>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/decline`,
      { method: 'POST' },
    );
    return mapPullRequest(data);
  },
});
