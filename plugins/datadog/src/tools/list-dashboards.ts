import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { dashboardSummarySchema, mapDashboardSummary } from './schemas.js';

export const listDashboards = defineTool({
  name: 'list_dashboards',
  displayName: 'List Dashboards',
  description:
    'List all dashboards in the Datadog organization. Returns dashboard summaries with titles, authors, and URLs.',
  summary: 'List all Datadog dashboards',
  icon: 'layout',
  group: 'Dashboards',
  input: z.object({
    filter_shared: z.boolean().optional().describe('Filter to only shared dashboards'),
  }),
  output: z.object({
    dashboards: z.array(dashboardSummarySchema),
    total: z.number().describe('Total number of dashboards'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.filter_shared !== undefined) query['filter[shared]'] = params.filter_shared;

    const data = await apiGet<{ dashboards?: Array<Record<string, unknown>> }>('/api/v1/dashboard', query);
    const dashboards = (data.dashboards ?? []).map(mapDashboardSummary);
    return { dashboards, total: dashboards.length };
  },
});
