import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet, apiPost } from '../datadog-api.js';
import { monitorSchema, mapMonitor } from './schemas.js';

export const cloneMonitor = defineTool({
  name: 'clone_monitor',
  displayName: 'Clone Monitor',
  description:
    'Clone an existing monitor to create a copy. Optionally override the name, query, message, or tags on the clone. The original monitor is not modified.',
  summary: 'Clone a monitor with optional overrides',
  icon: 'copy',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('ID of the monitor to clone'),
    name: z.string().optional().describe('Name for the cloned monitor. Defaults to "Clone of <original name>".'),
    query: z.string().optional().describe('Override the query on the clone'),
    message: z.string().optional().describe('Override the notification message on the clone'),
    tags: z.array(z.string()).optional().describe('Override tags on the clone. If omitted, inherits from original.'),
  }),
  output: z.object({
    monitor: monitorSchema,
  }),
  handle: async params => {
    const original = await apiGet<Record<string, unknown>>(`/api/v1/monitor/${params.monitor_id}`);

    const cloneBody: Record<string, unknown> = {
      name: params.name ?? `Clone of ${(original.name as string) ?? 'monitor'}`,
      type: original.type,
      query: params.query ?? original.query,
      message: params.message ?? original.message,
      tags: params.tags ?? original.tags,
      options: original.options,
      priority: original.priority,
    };

    const created = await apiPost<Record<string, unknown>>('/api/v1/monitor', cloneBody);
    return { monitor: mapMonitor(created) };
  },
});
