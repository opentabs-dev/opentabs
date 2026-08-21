import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { linkDevelopmentPullRequest as linkNativeDevelopmentPullRequest } from '../development-pull-requests.js';
import { developmentPullRequestMutationInputSchema } from './schemas.js';

export const linkDevelopmentPullRequest = defineTool({
  name: 'link_development_pull_request',
  displayName: 'Link Development Pull Request',
  description:
    'Link a pull request through GitHub\'s native issue Development relationship, which is also surfaced by the Project "Linked pull requests" field. Use this completion relationship only when merging the pull request to the default branch should complete the issue. This does not edit the pull request body or create a timeline-only reference. The operation is idempotent and verifies the persisted link.',
  summary: 'Link a native Development pull request',
  icon: 'link-2',
  group: 'Issues',
  input: developmentPullRequestMutationInputSchema,
  output: z.object({
    success: z.boolean().describe('Whether the native Development link exists after the operation'),
  }),
  handle: async params => {
    await linkNativeDevelopmentPullRequest(
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
