import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDelete } from '../datadog-api.js';

export const deleteMonitor = defineTool({
  name: 'delete_monitor',
  displayName: 'Delete Monitor',
  description: 'Permanently delete a monitor. This action cannot be undone.',
  summary: 'Delete a monitor by ID',
  icon: 'trash',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
    deleted_id: z.number().describe('ID of the deleted monitor'),
  }),
  handle: async params => {
    await apiDelete(`/api/v1/monitor/${params.monitor_id}`);
    return { success: true, deleted_id: params.monitor_id };
  },
});
