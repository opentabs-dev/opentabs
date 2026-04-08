import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const aggregateRumEvents = defineTool({
  name: 'aggregate_rum_events',
  displayName: 'Aggregate RUM Events',
  description:
    'Aggregate Datadog RUM events to compute counts, sums, averages, min, max, and cardinality, with optional grouping by fields or time intervals. Use this for aggregated analysis of RUM data such as session counts over time, error counts by page, or average loading times by browser.',
  summary: 'Aggregate RUM event data with grouping',
  icon: 'globe',
  group: 'RUM',
  input: z.object({
    query: z.string().describe('Search query to filter RUM events (e.g., "@type:error", "@type:view")'),
    compute: z
      .array(
        z.object({
          aggregation: z.enum(['count', 'avg', 'sum', 'min', 'max', 'cardinality']).describe('Aggregation function'),
          field: z.string().optional().describe('Field to aggregate on'),
          type: z.enum(['total', 'timeseries']).optional().describe('Compute type (default: total)'),
        }),
      )
      .describe('Aggregation computations to perform'),
    group_by: z
      .array(
        z.object({
          facet: z.string().describe('Field name to group by (e.g., "@browser.name", "@geo.country")'),
          limit: z.number().optional().describe('Max number of groups'),
        }),
      )
      .optional()
      .describe('Grouping configuration'),
    from: z.string().optional().describe('Start time (default now-15m)'),
    to: z.string().optional().describe('End time (default now)'),
  }),
  output: z.object({
    data: z.unknown().describe('Aggregation result buckets'),
    meta: z.unknown().describe('Query metadata'),
  }),
  handle: async params => {
    const data = await apiPost<{ data?: unknown; meta?: unknown }>('/api/v2/rum/analytics/aggregate', {
      filter: {
        query: params.query,
        from: params.from ?? 'now-15m',
        to: params.to ?? 'now',
      },
      compute: params.compute.map(c => ({
        aggregation: c.aggregation,
        ...(c.field ? { metric: c.field } : {}),
        type: c.type ?? 'total',
      })),
      ...(params.group_by?.length ? { group_by: params.group_by } : {}),
    });
    return { data: data.data ?? null, meta: data.meta ?? null };
  },
});
