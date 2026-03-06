import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiRaw } from '../github-api.js';

export const getPullRequestDiff = defineTool({
  name: 'get_pull_request_diff',
  displayName: 'Get Pull Request Diff',
  description: 'Get the raw diff of a pull request. Returns the unified diff text for all changed files.',
  summary: 'Get the raw diff of a pull request',
  icon: 'file-diff',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
  }),
  output: z.object({
    diff: z.string().describe('Raw unified diff text'),
  }),
  handle: async params => {
    const diff = await apiRaw(`/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`, {
      accept: 'application/vnd.github.diff',
    });
    return { diff };
  },
});
