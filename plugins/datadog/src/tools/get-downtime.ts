import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { downtimeSchema, mapDowntime } from './schemas.js';

export const getDowntime = defineTool({
  name: 'get_downtime',
  displayName: 'Get Downtime',
  description: 'Get detailed information about a specific scheduled downtime by ID.',
  summary: 'Get a downtime by ID',
  icon: 'clock',
  group: 'Downtimes',
  input: z.object({
    downtime_id: z.string().describe('Downtime ID'),
  }),
  output: z.object({
    downtime: downtimeSchema,
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Record<string, unknown> }>(`/api/v2/downtime/${params.downtime_id}`);
    return { downtime: mapDowntime(data.data ?? {}) };
  },
});
