import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getUsageSummary = defineTool({
  name: 'get_usage_summary',
  displayName: 'Get Usage Summary',
  description: 'Get usage summary for the Datadog organization over a time range.',
  summary: 'Get org usage summary',
  icon: 'bar-chart',
  group: 'Admin',
  input: z.object({
    start_month: z.string().describe('Start month in ISO format (e.g., "2024-01-01T00:00:00+00:00")'),
    end_month: z.string().optional().describe('End month in ISO format. Defaults to current month.'),
    include_org_details: z.boolean().optional().describe('Include child org details (default false)'),
  }),
  output: z.object({
    usage: z.unknown().describe('Usage summary data'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      start_month: params.start_month,
    };
    if (params.end_month) query.end_month = params.end_month;
    if (params.include_org_details) query.include_org_details = params.include_org_details;

    const data = await apiGet<Record<string, unknown>>('/api/v1/usage/summary', query);
    return { usage: data };
  },
});
