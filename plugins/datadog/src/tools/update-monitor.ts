import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPut } from '../datadog-api.js';

export const updateMonitor = defineTool({
  name: 'update_monitor',
  displayName: 'Update Monitor',
  description: 'Update an existing Datadog monitor. Only specified fields are changed.',
  summary: 'Update a monitor',
  icon: 'edit',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID to update'),
    name: z.string().optional().describe('New monitor name'),
    query: z.string().optional().describe('New monitor query'),
    message: z.string().optional().describe('New notification message'),
    tags: z.array(z.string()).optional().describe('New tags for the monitor'),
    options: z.unknown().optional().describe('New monitor options'),
  }),
  output: z.object({
    id: z.number().describe('Updated monitor ID'),
    name: z.string().describe('Monitor name'),
    type: z.string().describe('Monitor type'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.query !== undefined) body.query = params.query;
    if (params.message !== undefined) body.message = params.message;
    if (params.tags !== undefined) body.tags = params.tags;
    if (params.options !== undefined) body.options = params.options;

    const data = await apiPut<Record<string, unknown>>(`/api/v1/monitor/${params.monitor_id}`, body);
    return {
      id: (data.id as number) ?? params.monitor_id,
      name: (data.name as string) ?? '',
      type: (data.type as string) ?? '',
    };
  },
});
