import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { submitPageForm } from '../github-api.js';

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
    success: z.boolean().describe('Whether the review request was submitted'),
  }),
  handle: async params => {
    const fields: Record<string, string> = {
      'dummy-field-just-to-avoid-empty-submit': 'foo',
    };

    if (params.reviewers) {
      for (const reviewer of params.reviewers) {
        fields['reviewer_user_logins[]'] = reviewer;
      }
    }
    if (params.team_reviewers) {
      for (const team of params.team_reviewers) {
        fields['reviewer_team_slugs[]'] = team;
      }
    }

    await submitPageForm(
      `/${params.owner}/${params.repo}/pull/${params.pull_number}`,
      'form[action*="review-requests"]',
      fields,
    );

    return { success: true };
  },
});
