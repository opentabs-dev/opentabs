import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { monitorSchema, mapMonitor } from './schemas.js';

export const getMonitor = defineTool({
  name: 'get_monitor',
  displayName: 'Get Monitor',
  description: 'Get detailed information about a specific Datadog monitor by its ID.',
  summary: 'Get a monitor by ID',
  icon: 'monitor',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID'),
  }),
  output: z.object({
    monitor: monitorSchema,
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/monitor/${params.monitor_id}`);
    return { monitor: mapMonitor(data) };
  },
});
