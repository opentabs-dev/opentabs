import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const deleteProjectUpdate = defineTool({
  name: 'delete_project_update',
  displayName: 'Delete Project Update',
  description: 'Delete a status update from a Linear project.',
  summary: 'Delete a project status update',
  icon: 'activity',
  group: 'Projects',
  input: z.object({
    update_id: z.string().describe('Project update UUID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update was successfully deleted'),
  }),
  handle: async params => {
    const data = await graphql<{
      projectUpdateDelete: { success: boolean };
    }>(
      `mutation DeleteProjectUpdate($id: String!) {
        projectUpdateDelete(id: $id) {
          success
        }
      }`,
      { id: params.update_id },
    );

    if (!data.projectUpdateDelete) throw ToolError.internal('Project update deletion failed — no response');

    return { success: data.projectUpdateDelete.success };
  },
});
