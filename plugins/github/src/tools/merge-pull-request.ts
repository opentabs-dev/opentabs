import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const mergePullRequest = defineTool({
  name: 'merge_pull_request',
  displayName: 'Merge Pull Request',
  description: 'Merge a pull request. Supports merge commit, squash, and rebase strategies.',
  summary: 'Merge a pull request',
  icon: 'git-merge',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
    commit_title: z.string().optional().describe('Title for the merge commit'),
    commit_message: z.string().optional().describe('Extra detail for the merge commit'),
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy (default: squash)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the merge was initiated'),
  }),
  handle: async params => {
    const fields: Record<string, string> = {
      _method: 'put',
    };
    if (params.commit_title) fields.commit_title = params.commit_title;
    if (params.commit_message) fields.commit_message = params.commit_message;
    if (params.merge_method) fields.merge_method = params.merge_method;

    await submitPageForm(
      `/${params.owner}/${params.repo}/pull/${params.pull_number}`,
      `form[action$="/pull/${params.pull_number}/merge"]`,
      fields,
    );

    return { success: true };
  },
});
