import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapProject, projectSchema } from './schemas.js';

export const updateProject = defineTool({
  name: 'update_project',
  displayName: 'Update Project',
  description: 'Update an existing Linear project. Only specified fields are changed.',
  summary: 'Update a project',
  icon: 'folder-edit',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('Project UUID to update'),
    name: z.string().optional().describe('New project name'),
    description: z.string().optional().describe('New project description'),
    state: z.string().optional().describe('New project state (planned, started, paused, completed, canceled)'),
    target_date: z.string().optional().describe('New target completion date in YYYY-MM-DD format'),
    start_date: z.string().optional().describe('New start date in YYYY-MM-DD format'),
  }),
  output: z.object({
    project: projectSchema.describe('The updated project'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {};
    if (params.name !== undefined) input.name = params.name;
    if (params.description !== undefined) input.description = params.description;
    if (params.state !== undefined) input.state = params.state;
    if (params.target_date !== undefined) input.targetDate = params.target_date;
    if (params.start_date !== undefined) input.startDate = params.start_date;

    const data = await graphql<{
      projectUpdate: {
        success: boolean;
        project: Record<string, unknown>;
      };
    }>(
      `mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) {
          success
          project {
            id name description url createdAt updatedAt
            startDate targetDate
            status { name }
            lead { name displayName }
          }
        }
      }`,
      { id: params.project_id, input },
    );

    if (!data.projectUpdate?.success) throw ToolError.internal('Project update failed');
    if (!data.projectUpdate.project) throw ToolError.internal('Project update failed — no project returned');

    return { project: mapProject(data.projectUpdate.project as Parameters<typeof mapProject>[0]) };
  },
});
