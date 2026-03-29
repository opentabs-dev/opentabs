import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { initiativeSchema, mapInitiative, paginationSchema } from './schemas.js';

export const listInitiatives = defineTool({
  name: 'list_initiatives',
  displayName: 'List Initiatives',
  description: 'List initiatives in the Linear workspace, optionally filtered by status.',
  summary: 'List initiatives',
  icon: 'target',
  group: 'Initiatives',
  input: z.object({
    status: z.enum(['Planned', 'Active', 'Completed']).optional().describe('Filter by initiative status'),
    limit: z.number().optional().describe('Maximum number of results to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    initiatives: z.array(initiativeSchema).describe('List of initiatives'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const filter: Record<string, unknown> = {};
    if (params.status) filter.status = { eq: params.status };
    const filterArg = Object.keys(filter).length > 0 ? filter : undefined;

    const data = await graphql<{
      initiatives: {
        nodes: Record<string, unknown>[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(
      `query ListInitiatives($first: Int, $after: String, $filter: InitiativeFilter) {
        initiatives(first: $first, after: $after, filter: $filter) {
          nodes {
            id name description status color icon url createdAt updatedAt
            owner { name displayName }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first: limit, after: params.after, filter: filterArg },
    );

    if (!data.initiatives) throw ToolError.internal('Failed to list initiatives');
    const result = data.initiatives;
    return {
      initiatives: result.nodes.map(n => mapInitiative(n as Parameters<typeof mapInitiative>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
