import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const updateIssue = defineTool({
  name: 'update_issue',
  displayName: 'Update Issue',
  description: 'Update an existing issue — change title, body, state, labels, or assignees.',
  summary: 'Update an existing issue',
  icon: 'pencil',
  group: 'Issues',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    issue_number: z.number().int().min(1).describe('Issue number'),
    title: z.string().optional().describe('New issue title'),
    body: z.string().optional().describe('New issue body in Markdown'),
    state: z.enum(['open', 'closed']).optional().describe('Set issue state'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
  }),
  handle: async params => {
    const fields: Record<string, string> = {
      _method: 'put',
    };

    if (params.title !== undefined) fields['issue[title]'] = params.title;
    if (params.body !== undefined) fields['issue[body]'] = params.body;

    // For state changes, use the comment form with comment_and_close/comment_and_reopen
    if (params.state === 'closed') {
      await submitPageForm(
        `/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        'form.js-new-comment-form',
        { comment_and_close: '1', 'comment[body]': '' },
      );
    } else if (params.state === 'open') {
      await submitPageForm(
        `/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        'form.js-new-comment-form',
        { comment_and_reopen: '1', 'comment[body]': '' },
      );
    }

    // For title/body updates, use the issue update form
    if (params.title !== undefined || params.body !== undefined) {
      await submitPageForm(
        `/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        `form.js-comment-update[action$="/issues/${params.issue_number}"]`,
        fields,
      );
    }

    return { success: true };
  },
});
