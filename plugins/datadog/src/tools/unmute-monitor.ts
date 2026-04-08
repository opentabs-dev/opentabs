import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const unmuteMonitor = defineTool({
  name: 'unmute_monitor',
  displayName: 'Unmute Monitor',
  description: 'Unmute a previously muted monitor so it resumes alerting.',
  summary: 'Unmute a monitor to resume alerts',
  icon: 'volume',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID to unmute'),
    scope: z.string().optional().describe('Scope to unmute. Omit to unmute all scopes.'),
  }),
  output: z.object({
    success: z.boolean(),
    id: z.number().describe('Unmuted monitor ID'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.scope) body.scope = params.scope;

    await apiPost(`/api/v1/monitor/${params.monitor_id}/unmute`, body);
    return { success: true, id: params.monitor_id };
  },
});
