import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapMilestone, milestoneSchema } from './schemas.js';

export const getMilestone = defineTool({
  name: 'get_milestone',
  displayName: 'Get Milestone',
  description: 'Get detailed information about a single project milestone by its UUID.',
  summary: 'Get details of a single milestone',
  icon: 'milestone',
  group: 'Projects',
  input: z.object({
    milestone_id: z.string().describe('Milestone UUID'),
  }),
  output: z.object({
    milestone: milestoneSchema.describe('The requested milestone'),
  }),
  handle: async params => {
    const data = await graphql<{ projectMilestone: Record<string, unknown> }>(
      `query GetMilestone($id: String!) {
        projectMilestone(id: $id) {
          id name description targetDate sortOrder
        }
      }`,
      { id: params.milestone_id },
    );

    if (!data.projectMilestone) throw ToolError.notFound('Milestone not found');

    return { milestone: mapMilestone(data.projectMilestone as Parameters<typeof mapMilestone>[0]) };
  },
});
