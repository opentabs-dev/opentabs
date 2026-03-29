import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapStatusUpdate, statusUpdateSchema } from './schemas.js';

export const createProjectUpdate = defineTool({
  name: 'create_project_update',
  displayName: 'Create Project Update',
  description: 'Post a status update (health report) on a Linear project.',
  summary: 'Post a project status update',
  icon: 'activity',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to post the update on'),
    body: z.string().describe('Status update body in markdown'),
    health: z.enum(['onTrack', 'atRisk', 'offTrack']).describe('Project health status'),
  }),
  output: z.object({
    update: statusUpdateSchema.describe('The newly created status update'),
  }),
  handle: async params => {
    const data = await graphql<{
      projectUpdateCreate: {
        success: boolean;
        projectUpdate: Record<string, unknown>;
      };
    }>(
      `mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) {
        projectUpdateCreate(input: $input) {
          success
          projectUpdate {
            id body health createdAt updatedAt
            user { name displayName }
          }
        }
      }`,
      { input: { projectId: params.project_id, body: params.body, health: params.health } },
    );

    if (!data.projectUpdateCreate?.projectUpdate)
      throw ToolError.internal('Project update creation failed — no update returned');

    return {
      update: mapStatusUpdate(data.projectUpdateCreate.projectUpdate as Parameters<typeof mapStatusUpdate>[0]),
    };
  },
});
