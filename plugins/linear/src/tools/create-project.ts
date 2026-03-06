import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapProject, projectSchema } from './schemas.js';

export const createProject = defineTool({
  name: 'create_project',
  displayName: 'Create Project',
  description: 'Create a new project in Linear.',
  summary: 'Create a new project',
  icon: 'folder-plus',
  group: 'Projects',
  input: z.object({
    name: z.string().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    team_ids: z.array(z.string()).optional().describe('Array of team UUIDs to associate with the project'),
    state: z.string().optional().describe('Project state (planned, started, paused, completed, canceled)'),
    target_date: z.string().optional().describe('Target completion date in YYYY-MM-DD format'),
  }),
  output: z.object({
    project: projectSchema.describe('The newly created project'),
  }),
  handle: async params => {
    const input: Record<string, unknown> = {
      name: params.name,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.team_ids) input.teamIds = params.team_ids;
    if (params.state) input.state = params.state;
    if (params.target_date) input.targetDate = params.target_date;

    const data = await graphql<{
      projectCreate: {
        success: boolean;
        project: Record<string, unknown>;
      };
    }>(
      `mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project {
            id name description url createdAt updatedAt
            startDate targetDate
            status { name }
            lead { name displayName }
          }
        }
      }`,
      { input },
    );

    if (!data.projectCreate?.success) throw ToolError.internal('Project creation failed');
    if (!data.projectCreate.project) throw ToolError.internal('Project creation failed — no project returned');

    return { project: mapProject(data.projectCreate.project as Parameters<typeof mapProject>[0]) };
  },
});
