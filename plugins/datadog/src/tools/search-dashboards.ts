import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { dashboardSummarySchema, mapDashboardSummary } from './schemas.js';

export const searchDashboards = defineTool({
  name: 'search_dashboards',
  displayName: 'Search Dashboards',
  description:
    'Search dashboards by title or description. Performs a client-side substring match across all dashboards.',
  summary: 'Search dashboards by name',
  icon: 'search',
  group: 'Dashboards',
  input: z.object({
    query: z.string().describe('Search text to match against dashboard titles and descriptions'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 25)'),
  }),
  output: z.object({
    dashboards: z.array(dashboardSummarySchema),
    total: z.number().describe('Total matching dashboards'),
  }),
  handle: async params => {
    const data = await apiGet<{ dashboards?: Array<Record<string, unknown>> }>('/api/v1/dashboard');
    const q = params.query.toLowerCase();
    const filtered = (data.dashboards ?? [])
      .filter(d => {
        const title = ((d.title as string) ?? '').toLowerCase();
        const desc = ((d.description as string) ?? '').toLowerCase();
        return title.includes(q) || desc.includes(q);
      })
      .slice(0, params.limit ?? 25)
      .map(mapDashboardSummary);
    return { dashboards: filtered, total: filtered.length };
  },
});
