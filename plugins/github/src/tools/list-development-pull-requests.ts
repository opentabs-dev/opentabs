import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getDevelopmentPullRequestState } from '../development-pull-requests.js';
import { developmentPullRequestSchema, issueRelationLocatorInputSchema, mapDevelopmentPullRequest } from './schemas.js';

export const listDevelopmentPullRequests = defineTool({
  name: 'list_development_pull_requests',
  displayName: 'List Development Pull Requests',
  description:
    "List pull requests connected through GitHub's native issue Development relationship, including closed and merged references. Timeline mentions, body keywords, issue relationships, branches, and project fields are intentionally excluded.",
  summary: 'List native Development pull request links',
  icon: 'git-pull-request',
  group: 'Issues',
  input: issueRelationLocatorInputSchema,
  output: z.object({
    items: z
      .array(developmentPullRequestSchema)
      .describe('Pull requests returned by GitHub for the native Development relationship'),
  }),
  handle: async params => {
    const state = await getDevelopmentPullRequestState({
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issue_number,
    });

    return { items: state.pullRequests.map(mapDevelopmentPullRequest) };
  },
});
