import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { issueSchema, mapIssue, paginationSchema } from './schemas.js';

const ISSUE_FIELDS = `
  id identifier title description priority priorityLabel url
  createdAt updatedAt dueDate estimate
  state { name type }
  assignee { name displayName }
  team { key name }
  labels { nodes { name } }
  project { name }
  cycle { number }
`;

export const listSubIssues = defineTool({
  name: 'list_sub_issues',
  displayName: 'List Sub-Issues',
  description: 'List child/sub-issues of a parent Linear issue.',
  summary: 'List sub-issues of an issue',
  icon: 'list-tree',
  group: 'Issues',
  input: z.object({
    issue_id: z.string().describe('Parent issue UUID to list sub-issues for'),
    limit: z.number().optional().describe('Maximum number of results to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    sub_issues: z.array(issueSchema).describe('List of sub-issues'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const data = await graphql<{
      issue: {
        children: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query ListSubIssues($id: String!, $first: Int, $after: String) {
        issue(id: $id) {
          children(first: $first, after: $after) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: params.issue_id, first: limit, after: params.after },
    );

    if (!data.issue) throw ToolError.notFound('Issue not found');
    const result = data.issue.children;
    return {
      sub_issues: result.nodes.map(n => mapIssue(n as Parameters<typeof mapIssue>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
