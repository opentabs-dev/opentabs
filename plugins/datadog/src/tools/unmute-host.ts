import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const unmuteHost = defineTool({
  name: 'unmute_host',
  displayName: 'Unmute Host',
  description: 'Unmute a previously muted host to resume alerting.',
  summary: 'Unmute a host',
  icon: 'volume',
  group: 'Infrastructure',
  input: z.object({
    host_name: z.string().describe('Host name to unmute'),
  }),
  output: z.object({
    success: z.boolean(),
    hostname: z.string(),
    action: z.string(),
  }),
  handle: async params => {
    await apiPost(`/api/v1/host/${params.host_name}/unmute`, {});
    return { success: true, hostname: params.host_name, action: 'unmuted' };
  },
});
