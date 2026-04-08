import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { dashboardSummarySchema, mapDashboardSummary } from './schemas.js';

export const searchDashboardsAdvanced = defineTool({
  name: 'search_dashboards_advanced',
  displayName: 'Search Dashboards (Advanced)',
  description:
    'Search dashboards with advanced filters including author handle. Performs client-side filtering across all dashboards.',
  summary: 'Search dashboards with author filter',
  icon: 'search',
  group: 'Dashboards',
  input: z.object({
    query: z.string().optional().describe('Search text for dashboard titles and descriptions'),
    author_handle: z.string().optional().describe('Filter by author email handle'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 25)'),
  }),
  output: z.object({
    dashboards: z.array(dashboardSummarySchema),
    total: z.number().describe('Total matching dashboards'),
  }),
  handle: async params => {
    const data = await apiGet<{ dashboards?: Array<Record<string, unknown>> }>('/api/v1/dashboard');
    const q = (params.query ?? '').toLowerCase();
    const limit = params.limit ?? 25;

    const filtered = (data.dashboards ?? [])
      .filter(d => {
        if (q) {
          const title = ((d.title as string) ?? '').toLowerCase();
          const desc = ((d.description as string) ?? '').toLowerCase();
          if (!title.includes(q) && !desc.includes(q)) return false;
        }
        if (params.author_handle) {
          const author = (d.author_handle as string) ?? '';
          if (author !== params.author_handle) return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(mapDashboardSummary);

    return { dashboards: filtered, total: filtered.length };
  },
});
