import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const createPullRequest = defineTool({
  name: 'create_pull_request',
  displayName: 'Create Pull Request',
  description: 'Create a new pull request in a Bitbucket repository.',
  summary: 'Create a new pull request',
  icon: 'plus',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    title: z.string().describe('Pull request title'),
    source_branch: z.string().describe('Source branch name'),
    destination_branch: z
      .string()
      .optional()
      .describe('Destination branch name (defaults to the repository default branch)'),
    description: z.string().optional().describe('Pull request description in Markdown'),
    close_source_branch: z.boolean().optional().describe('Whether to delete the source branch after merge'),
    reviewers: z.array(z.string()).optional().describe('Array of reviewer UUIDs to request reviews from'),
  }),
  output: pullRequestSchema,
  handle: async params => {
    const body: Record<string, unknown> = {
      title: params.title,
      source: { branch: { name: params.source_branch } },
    };
    if (params.destination_branch !== undefined) {
      body.destination = { branch: { name: params.destination_branch } };
    }
    if (params.description !== undefined) body.description = params.description;
    if (params.close_source_branch !== undefined) body.close_source_branch = params.close_source_branch;
    if (params.reviewers !== undefined) {
      body.reviewers = params.reviewers.map(uuid => ({ uuid }));
    }

    const data = await api<RawPR>(`/repositories/${params.workspace}/${params.repo_slug}/pullrequests`, {
      method: 'POST',
      body,
    });
    return mapPullRequest(data);
  },
});
