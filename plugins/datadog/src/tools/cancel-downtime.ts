import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDelete } from '../datadog-api.js';

export const cancelDowntime = defineTool({
  name: 'cancel_downtime',
  displayName: 'Cancel Downtime',
  description: 'Cancel a scheduled downtime by ID. This resumes alerting for the affected monitors.',
  summary: 'Cancel a scheduled downtime',
  icon: 'x-circle',
  group: 'Downtimes',
  input: z.object({
    downtime_id: z.string().describe('Downtime ID to cancel'),
  }),
  output: z.object({
    success: z.boolean(),
    cancelled_id: z.string(),
  }),
  handle: async params => {
    await apiDelete(`/api/v2/downtime/${params.downtime_id}`);
    return { success: true, cancelled_id: params.downtime_id };
  },
});
