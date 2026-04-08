import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDelete } from '../datadog-api.js';

export const deleteDashboard = defineTool({
  name: 'delete_dashboard',
  displayName: 'Delete Dashboard',
  description: 'Permanently delete a Datadog dashboard. This action cannot be undone.',
  summary: 'Delete a dashboard by ID',
  icon: 'trash',
  group: 'Dashboards',
  input: z.object({
    dashboard_id: z.string().describe('Dashboard ID to delete (e.g., "abc-def-ghi")'),
  }),
  output: z.object({
    success: z.boolean(),
    deleted_id: z.string().describe('ID of the deleted dashboard'),
  }),
  handle: async params => {
    await apiDelete(`/api/v1/dashboard/${params.dashboard_id}`);
    return { success: true, deleted_id: params.dashboard_id };
  },
});
