import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { unlinkDevelopmentPullRequest as unlinkNativeDevelopmentPullRequest } from '../development-pull-requests.js';
import { developmentPullRequestMutationInputSchema } from './schemas.js';

export const unlinkDevelopmentPullRequest = defineTool({
  name: 'unlink_development_pull_request',
  displayName: 'Unlink Development Pull Request',
  description:
    'Remove a pull request from GitHub\'s native issue Development relationship and the Project "Linked pull requests" field. The issue and pull request bodies, states, comments, timeline references, issue relationships, and branches are left unchanged. The operation is idempotent and verifies the persisted link is absent.',
  summary: 'Unlink a native Development pull request',
  icon: 'unlink',
  group: 'Issues',
  input: developmentPullRequestMutationInputSchema,
  output: z.object({
    success: z.boolean().describe('Whether the native Development link is absent after the operation'),
  }),
  handle: async params => {
    await unlinkNativeDevelopmentPullRequest(
      {
        owner: params.owner,
        repo: params.repo,
        issueNumber: params.issue_number,
      },
      {
        owner: params.pull_request_owner ?? params.owner,
        repo: params.pull_request_repo ?? params.repo,
        pullNumber: params.pull_request_number,
      },
    );

    return { success: true };
  },
});
