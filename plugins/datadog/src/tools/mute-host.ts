import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const muteHost = defineTool({
  name: 'mute_host',
  displayName: 'Mute Host',
  description: 'Mute a host to suppress all monitor alerts originating from it.',
  summary: 'Mute a host to suppress alerts',
  icon: 'volume-off',
  group: 'Infrastructure',
  input: z.object({
    host_name: z.string().describe('Host name to mute'),
    end: z.number().optional().describe('POSIX timestamp when the mute should expire. Omit for indefinite.'),
    message: z.string().optional().describe('Reason for muting'),
    override: z.boolean().optional().describe('If true, replaces existing mute settings'),
  }),
  output: z.object({
    success: z.boolean(),
    hostname: z.string(),
    action: z.string(),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {};
    if (params.end) body.end = params.end;
    if (params.message) body.message = params.message;
    if (params.override) body.override = params.override;

    await apiPost(`/api/v1/host/${params.host_name}/mute`, body);
    return { success: true, hostname: params.host_name, action: 'muted' };
  },
});
