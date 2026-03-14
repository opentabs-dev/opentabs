import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const updatePullRequest = defineTool({
  name: 'update_pull_request',
  displayName: 'Update Pull Request',
  description: 'Update an existing pull request title or body, or close/reopen it.',
  summary: 'Update a pull request',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
    title: z.string().optional().describe('New pull request title'),
    body: z.string().optional().describe('New pull request body in Markdown'),
    state: z.enum(['open', 'closed']).optional().describe('Set PR state (close or reopen)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
  }),
  handle: async params => {
    const pagePath = `/${params.owner}/${params.repo}/pull/${params.pull_number}`;

    // Close/reopen via the comment form buttons
    if (params.state === 'closed') {
      await submitPageForm(pagePath, 'form.js-new-comment-form', {
        comment_and_close: '1',
        'comment[body]': '',
      });
    } else if (params.state === 'open') {
      await submitPageForm(pagePath, 'form.js-new-comment-form', {
        comment_and_reopen: '1',
        'comment[body]': '',
      });
    }

    // Title/body update via the issue update form (PRs use the same endpoint)
    if (params.title !== undefined || params.body !== undefined) {
      const fields: Record<string, string> = { _method: 'put' };
      if (params.title !== undefined) fields['issue[title]'] = params.title;
      if (params.body !== undefined) fields['issue[body]'] = params.body;

      await submitPageForm(pagePath, `form.js-comment-update[action$="/issues/${params.pull_number}"]`, fields);
    }

    return { success: true };
  },
});
