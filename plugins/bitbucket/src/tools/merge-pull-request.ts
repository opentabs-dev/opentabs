import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const mergePullRequest = defineTool({
  name: 'merge_pull_request',
  displayName: 'Merge Pull Request',
  description: 'Merge a pull request. Supports merge commit, squash, and fast-forward strategies.',
  summary: 'Merge a pull request',
  icon: 'git-merge',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
    merge_strategy: z
      .enum(['merge_commit', 'squash', 'fast_forward'])
      .optional()
      .describe('Merge strategy (default merge_commit)'),
    close_source_branch: z.boolean().optional().describe('Whether to delete the source branch after merge'),
    message: z.string().optional().describe('Merge commit message'),
  }),
  output: pullRequestSchema,
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.merge_strategy !== undefined) body.merge_strategy = params.merge_strategy;
    if (params.close_source_branch !== undefined) body.close_source_branch = params.close_source_branch;
    if (params.message !== undefined) body.message = params.message;

    const data = await api<RawPR>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/merge`,
      { method: 'POST', body },
    );
    return mapPullRequest(data);
  },
});
