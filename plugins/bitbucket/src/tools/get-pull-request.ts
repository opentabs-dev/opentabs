import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const getPullRequest = defineTool({
  name: 'get_pull_request',
  displayName: 'Get Pull Request',
  description: 'Get detailed information about a specific pull request.',
  summary: 'Get pull request details',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
  }),
  output: pullRequestSchema,
  handle: async params => {
    const data = await api<RawPR>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}`,
    );
    return mapPullRequest(data);
  },
});
