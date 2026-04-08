import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { hostSchema, mapHost } from './schemas.js';

export const listHosts = defineTool({
  name: 'list_hosts',
  displayName: 'List Hosts',
  description: 'List infrastructure hosts reporting to Datadog. Supports filtering by name and pagination.',
  summary: 'List infrastructure hosts',
  icon: 'server',
  group: 'Infrastructure',
  input: z.object({
    filter: z.string().optional().describe('Filter string for host names'),
    count: z.number().int().min(1).max(1000).optional().describe('Number of hosts (default 100)'),
    start: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
    sort_field: z.string().optional().describe('Sort field (e.g., "name", "apps", "cpu")'),
    sort_dir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
  }),
  output: z.object({
    hosts: z.array(hostSchema),
    total_matching: z.number().describe('Total number of matching hosts'),
    total_returned: z.number().describe('Number of hosts returned'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      count: params.count ?? 100,
      start: params.start ?? 0,
    };
    if (params.filter) query.filter = params.filter;
    if (params.sort_field) query.sort_field = params.sort_field;
    if (params.sort_dir) query.sort_dir = params.sort_dir;

    const data = await apiGet<{
      host_list?: Array<Record<string, unknown>>;
      total_matching?: number;
      total_returned?: number;
    }>('/api/v1/hosts', query);
    return {
      hosts: (data.host_list ?? []).map(mapHost),
      total_matching: data.total_matching ?? 0,
      total_returned: data.total_returned ?? 0,
    };
  },
});
