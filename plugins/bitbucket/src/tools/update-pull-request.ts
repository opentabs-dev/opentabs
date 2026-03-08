import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPR, pullRequestSchema, mapPullRequest } from './schemas.js';

export const updatePullRequest = defineTool({
  name: 'update_pull_request',
  displayName: 'Update Pull Request',
  description: 'Update an existing pull request. Only specified fields are changed; omitted fields remain unchanged.',
  summary: 'Update a pull request',
  icon: 'edit',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
    title: z.string().optional().describe('New pull request title'),
    description: z.string().optional().describe('New pull request description in Markdown'),
    destination_branch: z.string().optional().describe('New destination branch name'),
    close_source_branch: z.boolean().optional().describe('Whether to delete the source branch after merge'),
    reviewers: z.array(z.string()).optional().describe('Array of reviewer UUIDs — replaces the existing reviewer list'),
  }),
  output: pullRequestSchema,
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.description !== undefined) body.description = params.description;
    if (params.destination_branch !== undefined) {
      body.destination = { branch: { name: params.destination_branch } };
    }
    if (params.close_source_branch !== undefined) body.close_source_branch = params.close_source_branch;
    if (params.reviewers !== undefined) {
      body.reviewers = params.reviewers.map(uuid => ({ uuid }));
    }

    const data = await api<RawPR>(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}`,
      { method: 'PUT', body },
    );
    return mapPullRequest(data);
  },
});
