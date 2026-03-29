import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { issueHistorySchema, mapIssueHistory, paginationSchema } from './schemas.js';

export const listIssueHistory = defineTool({
  name: 'list_issue_history',
  displayName: 'List Issue History',
  description: 'List the change history (state changes, assignee changes, priority changes) for a Linear issue.',
  summary: 'List issue change history',
  icon: 'history',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Issue UUID to list history for'),
    limit: z.number().optional().describe('Maximum number of entries to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    history: z.array(issueHistorySchema).describe('List of history entries'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const data = await graphql<{
      issue: {
        history: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query ListIssueHistory($id: String!, $first: Int, $after: String) {
        issue(id: $id) {
          history(first: $first, after: $after) {
            nodes {
              id createdAt
              actor { name displayName }
              fromState { name }
              toState { name }
              fromAssignee { name displayName }
              toAssignee { name displayName }
              fromPriority
              toPriority
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: params.issue_id, first: limit, after: params.after },
    );

    if (!data.issue) throw ToolError.notFound('Issue not found');
    const result = data.issue.history;
    return {
      history: result.nodes.map(n => mapIssueHistory(n as Parameters<typeof mapIssueHistory>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
