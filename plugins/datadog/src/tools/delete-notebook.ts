import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDelete } from '../datadog-api.js';

export const deleteNotebook = defineTool({
  name: 'delete_notebook',
  displayName: 'Delete Notebook',
  description: 'Permanently delete a Datadog notebook. This action cannot be undone.',
  summary: 'Delete a notebook by ID',
  icon: 'trash',
  group: 'Notebooks',
  input: z.object({
    notebook_id: z.number().int().describe('Notebook ID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
    deleted_id: z.number(),
  }),
  handle: async params => {
    await apiDelete(`/api/v1/notebooks/${params.notebook_id}`);
    return { success: true, deleted_id: params.notebook_id };
  },
});
