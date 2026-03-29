import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapMilestone, milestoneSchema } from './schemas.js';

export const createMilestone = defineTool({
  name: 'create_milestone',
  displayName: 'Create Milestone',
  description: 'Create a new milestone in a Linear project.',
  summary: 'Create a new project milestone',
  icon: 'milestone',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to create the milestone in'),
    name: z.string().describe('Milestone name'),
    description: z.string().optional().describe('Milestone description'),
    target_date: z.string().optional().describe('Target date in YYYY-MM-DD format'),
  }),
  output: z.object({
    milestone: milestoneSchema.describe('The newly created milestone'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      projectId: params.project_id,
      name: params.name,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.target_date) input.targetDate = params.target_date;

    const data = await graphql<{
      projectMilestoneCreate: {
        success: boolean;
        projectMilestone: Record<string, unknown>;
      };
    }>(
      `mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
        projectMilestoneCreate(input: $input) {
          success
          projectMilestone {
            id name description targetDate sortOrder
          }
        }
      }`,
      { input },
    );

    if (!data.projectMilestoneCreate?.projectMilestone)
      throw ToolError.internal('Milestone creation failed — no milestone returned');

    return {
      milestone: mapMilestone(data.projectMilestoneCreate.projectMilestone as Parameters<typeof mapMilestone>[0]),
    };
  },
});
