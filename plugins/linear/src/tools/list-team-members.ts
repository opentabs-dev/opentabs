import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapUser, paginationSchema, userSchema } from './schemas.js';

export const listTeamMembers = defineTool({
  name: 'list_team_members',
  displayName: 'List Team Members',
  description: 'List members of a specific Linear team.',
  summary: 'List members of a team',
  icon: 'users',
  group: 'Teams & Users',
  input: z.object({
    team_id: z.string().describe('Team UUID to list members for'),
    limit: z.number().optional().describe('Maximum number of results to return (default 50, max 100)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    members: z.array(userSchema).describe('List of team members'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 50, 100);

    const data = await graphql<{
      team: {
        members: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query ListTeamMembers($id: String!, $first: Int, $after: String) {
        team(id: $id) {
          members(first: $first, after: $after) {
            nodes {
              id name email displayName active admin
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: params.team_id, first: limit, after: params.after },
    );

    if (!data.team) throw ToolError.notFound('Team not found');
    const result = data.team.members;
    return {
      members: result.nodes.map(n => mapUser(n as Parameters<typeof mapUser>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
