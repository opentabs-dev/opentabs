import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const createMonitor = defineTool({
  name: 'create_monitor',
  displayName: 'Create Monitor',
  description:
    'Create a new Datadog monitor. Supports metric, service check, event, log, process, synthetics, and other monitor types.',
  summary: 'Create a new monitor',
  icon: 'plus',
  group: 'Monitors',
  input: z.object({
    name: z.string().describe('Monitor name'),
    type: z
      .string()
      .describe(
        'Monitor type (e.g., "metric alert", "service check", "event alert", "log alert", "process alert", "synthetics alert")',
      ),
    query: z.string().describe('Monitor query string'),
    message: z.string().optional().describe('Notification message (supports @mentions and markdown)'),
    tags: z.array(z.string()).optional().describe('Tags to associate with the monitor'),
    options: z.unknown().optional().describe('Monitor options (thresholds, notify_no_data, etc.)'),
  }),
  output: z.object({
    id: z.number().describe('Created monitor ID'),
    name: z.string().describe('Monitor name'),
    type: z.string().describe('Monitor type'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      name: params.name,
      type: params.type,
      query: params.query,
    };
    if (params.message) body.message = params.message;
    if (params.tags) body.tags = params.tags;
    if (params.options) body.options = params.options;

    const data = await apiPost<Record<string, unknown>>('/api/v1/monitor', body);
    return {
      id: (data.id as number) ?? 0,
      name: (data.name as string) ?? '',
      type: (data.type as string) ?? '',
    };
  },
});
