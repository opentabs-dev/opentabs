import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { hostSchema, mapHost } from './schemas.js';

export const getHostInfo = defineTool({
  name: 'get_host_info',
  displayName: 'Get Host Info',
  description: 'Get detailed information about a specific host by hostname.',
  summary: 'Get host details by name',
  icon: 'server',
  group: 'Infrastructure',
  input: z.object({
    hostname: z.string().describe('Hostname to look up'),
  }),
  output: z.object({
    host: hostSchema.nullable().describe('Host details, or null if not found'),
  }),
  handle: async params => {
    const data = await apiGet<{ host_list?: Array<Record<string, unknown>> }>('/api/v1/hosts', {
      filter: params.hostname,
      count: 1,
    });
    const hosts = data.host_list ?? [];
    const first = hosts[0];
    return { host: first ? mapHost(first) : null };
  },
});
