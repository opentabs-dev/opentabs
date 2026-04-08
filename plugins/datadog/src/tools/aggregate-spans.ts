import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiPost } from '../datadog-api.js';

export const aggregateSpans = defineTool({
  name: 'aggregate_spans',
  displayName: 'Aggregate Spans',
  description:
    'Aggregate Datadog APM spans to compute counts, sums, averages, min, max, and cardinality, with optional grouping by fields or time intervals. Use this for aggregated analysis such as request counts over time, average duration by service, or error counts grouped by endpoint.',
  summary: 'Aggregate APM span data with grouping',
  icon: 'bar-chart',
  group: 'APM',
  input: z.object({
    query: z.string().describe('Search query to filter spans (e.g., "service:web-store", "@http.status_code:500")'),
    compute: z
      .array(
        z.object({
          aggregation: z.enum(['count', 'avg', 'sum', 'min', 'max', 'cardinality']).describe('Aggregation function'),
          field: z.string().optional().describe('Field to aggregate on (use "*" or omit for count)'),
          type: z.enum(['total', 'timeseries']).optional().describe('Compute type (default: total)'),
        }),
      )
      .describe('Aggregation computations to perform'),
    group_by: z
      .array(
        z.object({
          facet: z.string().describe('Field name to group by (e.g., "service", "resource_name")'),
          limit: z.number().optional().describe('Max number of groups'),
          sort: z
            .object({
              aggregation: z.string().describe('Aggregation to sort by'),
              order: z.enum(['asc', 'desc']).describe('Sort order'),
            })
            .optional(),
        }),
      )
      .optional()
      .describe('Grouping configuration'),
    from: z.string().optional().describe('Start time (default now-1h)'),
    to: z.string().optional().describe('End time (default now)'),
  }),
  output: z.object({
    data: z.unknown().describe('Aggregation result buckets'),
    meta: z.unknown().describe('Query metadata'),
  }),
  handle: async params => {
    const data = await apiPost<{ data?: unknown; meta?: unknown }>('/api/v2/spans/analytics/aggregate', {
      data: {
        type: 'aggregate_request',
        attributes: {
          filter: {
            query: params.query,
            from: params.from ?? 'now-1h',
            to: params.to ?? 'now',
          },
          compute: params.compute.map(c => ({
            aggregation: c.aggregation,
            ...(c.field ? { metric: c.field } : {}),
            type: c.type ?? 'total',
          })),
          ...(params.group_by?.length ? { group_by: params.group_by } : {}),
        },
      },
    });
    return { data: data.data ?? null, meta: data.meta ?? null };
  },
});
