import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

export const createComment = defineTool({
  name: 'create_comment',
  displayName: 'Create Comment',
  description: 'Add a comment to an issue or pull request.',
  summary: 'Add a comment to an issue or pull request',
  icon: 'message-square-plus',
  group: 'Comments',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    issue_number: z.number().int().min(1).describe('Issue or pull request number'),
    body: z.string().min(1).describe('Comment body in Markdown'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the comment was created successfully'),
  }),
  handle: async params => {
    // Determine if this is a PR or issue by trying the PR URL first
    const prPath = `/${params.owner}/${params.repo}/pull/${params.issue_number}`;
    const issuePath = `/${params.owner}/${params.repo}/issues/${params.issue_number}`;

    // Try PR page first, fall back to issue page
    let pagePath: string;
    try {
      await submitPageForm(prPath, 'form.js-new-comment-form', {
        'comment[body]': params.body,
      });
      return { success: true };
    } catch {
      // If PR page doesn't have the form, try issue page
      pagePath = issuePath;
    }

    await submitPageForm(pagePath, 'form.js-new-comment-form', {
      'comment[body]': params.body,
    });

    return { success: true };
  },
});
