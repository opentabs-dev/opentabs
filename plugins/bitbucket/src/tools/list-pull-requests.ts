import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const listPullRequests = defineTool({
  name: 'list_pull_requests',
  displayName: 'List Pull Requests',
  description:
    'List pull requests for a Bitbucket repository. By default returns open pull requests. Supports pagination and state filtering.',
  summary: 'List pull requests for a repository',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    state: z
      .enum(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'])
      .optional()
      .describe('Pull request state filter (default OPEN)'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    pull_requests: z.array(pullRequestSchema).describe('Array of pull requests'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      state: params.state,
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawPR[] }>(`/repositories/${params.workspace}/${params.repo_slug}/pullrequests`, {
      query,
    });
    return { pull_requests: (data.values ?? []).map(mapPullRequest) };
  },
});
