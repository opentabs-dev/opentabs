import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawComment, commentSchema, mapComment } from './schemas.js';

export const listPrComments = defineTool({
  name: 'list_pr_comments',
  displayName: 'List PR Comments',
  description: 'List comments on a pull request. Supports pagination.',
  summary: 'List pull request comments',
  icon: 'message-square',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    comments: z.array(commentSchema).describe('Array of pull request comments'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawComment[] }>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/comments`,
      { query },
    );
    return { comments: (data.values ?? []).map(mapComment) };
  },
});
