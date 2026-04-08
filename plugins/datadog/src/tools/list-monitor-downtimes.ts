import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listMonitorDowntimes = defineTool({
  name: 'list_monitor_downtimes',
  displayName: 'List Monitor Downtimes',
  description: 'Get downtimes associated with a specific monitor.',
  summary: 'Get downtimes for a monitor',
  icon: 'clock',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID to get downtimes for'),
  }),
  output: z.object({
    monitor_id: z.number().describe('Monitor ID'),
    downtimes: z.unknown().describe('Downtimes associated with this monitor'),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/monitor/${params.monitor_id}`, {
      with_downtimes: true,
    });
    return {
      monitor_id: params.monitor_id,
      downtimes: data.matching_downtimes ?? [],
    };
  },
});
