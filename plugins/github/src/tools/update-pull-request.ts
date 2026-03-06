import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';
import { mapPullRequest, pullRequestSchema } from './schemas.js';

export const updatePullRequest = defineTool({
  name: 'update_pull_request',
  displayName: 'Update Pull Request',
  description: 'Update an existing pull request. Only specified fields are changed; omitted fields remain unchanged.',
  summary: 'Update a pull request',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
    title: z.string().optional().describe('New pull request title'),
    body: z.string().optional().describe('New pull request body in Markdown'),
    state: z.enum(['open', 'closed']).optional().describe('Set PR state'),
    base: z.string().optional().describe('New target branch name to merge into'),
    draft: z.boolean().optional().describe('Convert to draft or ready for review'),
  }),
  output: z.object({
    pull_request: pullRequestSchema.describe('The updated pull request'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.body !== undefined) body.body = params.body;
    if (params.state !== undefined) body.state = params.state;
    if (params.base !== undefined) body.base = params.base;
    if (params.draft !== undefined) body.draft = params.draft;

    const data = await api<Record<string, unknown>>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`,
      { method: 'PATCH', body },
    );
    return { pull_request: mapPullRequest(data) };
  },
});
