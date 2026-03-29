import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapStatusUpdate, paginationSchema, statusUpdateSchema } from './schemas.js';

export const listProjectUpdates = defineTool({
  name: 'list_project_updates',
  displayName: 'List Project Updates',
  description: 'List status updates (health reports) for a Linear project.',
  summary: 'List project status updates',
  icon: 'activity',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to list updates for'),
    limit: z.number().optional().describe('Maximum number of results to return (default 25, max 50)'),
    after: z.string().optional().describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    updates: z.array(statusUpdateSchema).describe('List of status updates'),
    pagination: paginationSchema.describe('Pagination info for fetching more results'),
  }),
  handle: async params => {
    const limit = Math.min(params.limit ?? 25, 50);

    const data = await graphql<{
      project: {
        projectUpdates: {
          nodes: Record<string, unknown>[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    }>(
      `query ListProjectUpdates($id: String!, $first: Int, $after: String) {
        project(id: $id) {
          projectUpdates(first: $first, after: $after) {
            nodes {
              id body health createdAt updatedAt
              user { name displayName }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: params.project_id, first: limit, after: params.after },
    );

    if (!data.project) throw ToolError.notFound('Project not found');
    const result = data.project.projectUpdates;
    return {
      updates: result.nodes.map(n => mapStatusUpdate(n as Parameters<typeof mapStatusUpdate>[0])),
      pagination: {
        has_next_page: result.pageInfo?.hasNextPage ?? false,
        end_cursor: result.pageInfo?.endCursor ?? '',
      },
    };
  },
});
