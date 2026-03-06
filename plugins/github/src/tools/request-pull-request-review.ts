import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../github-api.js';
import { mapPullRequest, pullRequestSchema } from './schemas.js';

export const requestPullRequestReview = defineTool({
  name: 'request_pull_request_review',
  displayName: 'Request Pull Request Review',
  description:
    'Request reviewers for a pull request. Specify individual users and/or team slugs to request reviews from.',
  summary: 'Request reviewers for a pull request',
  icon: 'user-plus',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
    reviewers: z.array(z.string()).optional().describe('Array of user logins to request review from'),
    team_reviewers: z.array(z.string()).optional().describe('Array of team slugs to request review from'),
  }),
  output: z.object({
    pull_request: pullRequestSchema.describe('The pull request with updated reviewers'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.reviewers !== undefined) body.reviewers = params.reviewers;
    if (params.team_reviewers !== undefined) body.team_reviewers = params.team_reviewers;

    const data = await api<Record<string, unknown>>(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/requested_reviewers`,
      { method: 'POST', body },
    );
    return { pull_request: mapPullRequest(data) };
  },
});
