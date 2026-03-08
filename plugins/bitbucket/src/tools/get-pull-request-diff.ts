import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiRaw } from '../bitbucket-api.js';

export const getPullRequestDiff = defineTool({
  name: 'get_pull_request_diff',
  displayName: 'Get Pull Request Diff',
  description: 'Get the unified diff of all changed files in a pull request.',
  summary: 'Get pull request diff',
  icon: 'file-diff',
  group: 'Pull Requests',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pull_request_id: z.number().int().describe('Pull request ID'),
  }),
  output: z.object({
    diff: z.string().describe('Unified diff text for all changed files'),
  }),
  handle: async params => {
    const diff = await apiRaw(
      `/repositories/${params.workspace}/${params.repo_slug}/pullrequests/${params.pull_request_id}/diff`,
    );
    return { diff };
  },
});
