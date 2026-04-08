import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const muteMonitor = defineTool({
  name: 'mute_monitor',
  displayName: 'Mute Monitor',
  description: 'Mute a monitor so it does not trigger alerts. Optionally specify a scope and end time.',
  summary: 'Mute a monitor to suppress alerts',
  icon: 'volume-off',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID to mute'),
    scope: z.string().optional().describe('Scope to mute (e.g., "host:myhost"). Omit to mute all scopes.'),
    end: z.number().optional().describe('POSIX timestamp for when the mute should end. Omit for indefinite.'),
  }),
  output: z.object({
    success: z.boolean(),
    id: z.number().describe('Muted monitor ID'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.scope) body.scope = params.scope;
    if (params.end) body.end = params.end;

    await apiPost(`/api/v1/monitor/${params.monitor_id}/mute`, body);
    return { success: true, id: params.monitor_id };
  },
});
