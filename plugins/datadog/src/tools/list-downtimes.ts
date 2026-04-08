import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { downtimeSchema, mapDowntime } from './schemas.js';

export const listDowntimes = defineTool({
  name: 'list_downtimes',
  displayName: 'List Downtimes',
  description: 'List scheduled downtimes (maintenance windows) in the Datadog organization.',
  summary: 'List maintenance windows',
  icon: 'clock',
  group: 'Downtimes',
  input: z.object({
    current_only: z.boolean().optional().describe('If true, return only active downtimes'),
    page_limit: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page_offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    downtimes: z.array(downtimeSchema),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      'page[limit]': params.page_limit ?? 25,
      'page[offset]': params.page_offset ?? 0,
    };
    if (params.current_only) query.current_only = true;

    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/downtime', query);
    return { downtimes: (data.data ?? []).map(mapDowntime) };
  },
});
