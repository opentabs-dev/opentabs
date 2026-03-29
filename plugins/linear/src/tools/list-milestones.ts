import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapMilestone, milestoneSchema } from './schemas.js';

export const listMilestones = defineTool({
  name: 'list_milestones',
  displayName: 'List Milestones',
  description: 'List milestones for a Linear project.',
  summary: 'List project milestones',
  icon: 'milestone',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to list milestones for'),
  }),
  output: z.object({
    milestones: z.array(milestoneSchema).describe('List of milestones in the project'),
  }),
  handle: async params => {
    const data = await graphql<{
      project: {
        projectMilestones: {
          nodes: Record<string, unknown>[];
        };
      };
    }>(
      `query ListMilestones($id: String!) {
        project(id: $id) {
          projectMilestones {
            nodes {
              id name description targetDate sortOrder
            }
          }
        }
      }`,
      { id: params.project_id },
    );

    if (!data.project) throw ToolError.notFound('Project not found');

    return {
      milestones: (data.project.projectMilestones?.nodes ?? []).map(n =>
        mapMilestone(n as Parameters<typeof mapMilestone>[0]),
      ),
    };
  },
});
