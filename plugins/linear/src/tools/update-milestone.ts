import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapMilestone, milestoneSchema } from './schemas.js';

export const updateMilestone = defineTool({
  name: 'update_milestone',
  displayName: 'Update Milestone',
  description: 'Update an existing milestone in a Linear project. Only specified fields are changed.',
  summary: 'Update a project milestone',
  icon: 'milestone',
  group: 'Projects',
  input: z.object({
    milestone_id: z.string().describe('Milestone UUID to update'),
    name: z.string().optional().describe('New milestone name'),
    description: z.string().optional().describe('New milestone description'),
    target_date: z.string().optional().describe('New target date in YYYY-MM-DD format'),
  }),
  output: z.object({
    milestone: milestoneSchema.describe('The updated milestone'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.name !== undefined) input.name = params.name;
    if (params.description !== undefined) input.description = params.description;
    if (params.target_date !== undefined) input.targetDate = params.target_date;

    const data = await graphql<{
      projectMilestoneUpdate: {
        success: boolean;
        projectMilestone: Record<string, unknown>;
      };
    }>(
      `mutation UpdateMilestone($id: String!, $input: ProjectMilestoneUpdateInput!) {
        projectMilestoneUpdate(id: $id, input: $input) {
          success
          projectMilestone {
            id name description targetDate sortOrder
          }
        }
      }`,
      { id: params.milestone_id, input },
    );

    if (!data.projectMilestoneUpdate?.projectMilestone)
      throw ToolError.internal('Milestone update failed — no milestone returned');

    return {
      milestone: mapMilestone(data.projectMilestoneUpdate.projectMilestone as Parameters<typeof mapMilestone>[0]),
    };
  },
});
