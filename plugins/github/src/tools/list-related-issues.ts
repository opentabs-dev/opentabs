import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getIssueRelationState } from '../issue-relations.js';
import { issueRelationLocatorInputSchema, mapRelatedIssue, relatedIssueSchema } from './schemas.js';

export const listRelatedIssues = defineTool({
  name: 'list_related_issues',
  displayName: 'List Related Issues',
  description:
    'List issues connected by GitHub\'s native, undirected "Relates to" relationship. Blockers, blocking issues, parent/sub-issues, and linked pull requests are intentionally excluded. Returns GitHub\'s relationship sidebar summary plus the total count and whether GitHub truncated the returned items.',
  summary: 'List native Relates to issue relationships',
  icon: 'link',
  group: 'Issues',
  input: issueRelationLocatorInputSchema,
  output: z.object({
    items: z.array(relatedIssueSchema).describe('Issues connected by the native Relates to relationship'),
    total_count: z.number().int().min(0).describe('Total number of native Relates to relationships'),
    has_more: z.boolean().describe('Whether GitHub reports additional related issues beyond the returned items'),
  }),
  handle: async params => {
    const state = await getIssueRelationState({
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issue_number,
    });

    return {
      items: state.relatedIssues.map(mapRelatedIssue),
      total_count: state.totalCount,
      has_more: state.hasMore,
    };
  },
});
