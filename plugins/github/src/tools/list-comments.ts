import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated } from '../github-api.js';
import { commentSchema } from './schemas.js';

export const listComments = defineTool({
  name: 'list_comments',
  displayName: 'List Comments',
  description: 'List comments on an issue or pull request.',
  summary: 'List comments on an issue or pull request',
  icon: 'message-square',
  group: 'Comments',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    issue_number: z.number().int().min(1).describe('Issue or pull request number'),
  }),
  output: z.object({
    comments: z.array(commentSchema).describe('List of comments'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    // Fetch the issue/PR page HTML and parse comments from the rendered timeline
    const html = await fetchText(`/${params.owner}/${params.repo}/issues/${params.issue_number}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Extract comments from the timeline DOM structure
    const commentElements = doc.querySelectorAll('.js-comment-container, .timeline-comment');
    const comments = [];

    for (const el of commentElements) {
      const bodyEl = el.querySelector('.comment-body, .js-comment-body');
      const authorEl = el.querySelector('.author, a.timeline-comment-header-text');
      const timeEl = el.querySelector('relative-time, time');
      const linkEl = el.querySelector('a[id^="issuecomment-"]');
      const id = linkEl?.getAttribute('id')?.replace('issuecomment-', '') ?? '0';

      if (bodyEl) {
        comments.push({
          id: Number.parseInt(id, 10) || 0,
          body: bodyEl.textContent?.trim() ?? '',
          user_login: authorEl?.textContent?.trim() ?? '',
          html_url: linkEl
            ? `https://github.com/${params.owner}/${params.repo}/issues/${params.issue_number}#${linkEl.getAttribute('id')}`
            : '',
          created_at: timeEl?.getAttribute('datetime') ?? '',
          updated_at: timeEl?.getAttribute('datetime') ?? '',
        });
      }
    }

    return { comments };
  },
});
