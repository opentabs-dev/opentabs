import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const createDowntime = defineTool({
  name: 'create_downtime',
  displayName: 'Create Downtime',
  description: 'Create a scheduled downtime (maintenance window) in Datadog.',
  summary: 'Schedule a new downtime',
  icon: 'clock',
  group: 'Downtimes',
  input: z.object({
    scope: z.string().describe('Scope for the downtime (e.g., "host:myhost", "env:prod")'),
    start: z.number().optional().describe('Start time as POSIX epoch seconds. Omit for immediate.'),
    end: z.number().optional().describe('End time as POSIX epoch seconds. Omit for indefinite.'),
    message: z.string().optional().describe('Message to include with the downtime notification'),
    monitor_tags: z.array(z.string()).optional().describe('Monitor tags to scope the downtime to specific monitors'),
  }),
  output: z.object({
    downtime: z.unknown().describe('Created downtime object'),
  }),
  handle: async params => {
    const attributes: Record<string, unknown> = {
      scope: params.scope,
    };
    if (params.message) attributes.message = params.message;
    if (params.monitor_tags) attributes.monitor_identifier = { monitor_tags: params.monitor_tags };

    const schedule: Record<string, unknown> = {};
    if (params.start) schedule.start = new Date(params.start * 1000).toISOString();
    if (params.end) schedule.end = new Date(params.end * 1000).toISOString();
    if (Object.keys(schedule).length > 0) attributes.schedule = schedule;

    const body = {
      data: {
        type: 'downtime',
        attributes,
      },
    };

    const data = await apiPost<Record<string, unknown>>('/api/v2/downtime', body);
    return { downtime: data.data ?? data };
  },
});
