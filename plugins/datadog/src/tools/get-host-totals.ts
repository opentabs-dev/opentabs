import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getHostTotals = defineTool({
  name: 'get_host_totals',
  displayName: 'Get Host Totals',
  description: 'Get the total number of active and up hosts in the organization.',
  summary: 'Get total active/up host counts',
  icon: 'server',
  group: 'Infrastructure',
  input: z.object({}),
  output: z.object({
    total_active: z.number().describe('Total number of active hosts'),
    total_up: z.number().describe('Total number of hosts currently reporting'),
  }),
  handle: async () => {
    const data = await apiGet<{ total_active?: number; total_up?: number }>('/api/v1/hosts/totals');
    return {
      total_active: data.total_active ?? 0,
      total_up: data.total_up ?? 0,
    };
  },
});
