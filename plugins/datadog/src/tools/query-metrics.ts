import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { metricSeriesSchema } from './schemas.js';

export const queryMetrics = defineTool({
  name: 'query_metrics',
  displayName: 'Query Metrics',
  description:
    'Query time-series metric data from Datadog. Use standard metric query syntax with aggregation, scope, and optional group-by (e.g., "avg:system.cpu.user{env:prod} by {host}").',
  summary: 'Query metric time-series data',
  icon: 'bar-chart',
  group: 'Metrics',
  input: z.object({
    query: z.string().describe('Metric query (e.g., "avg:system.cpu.user{*}", "sum:my.metric{env:prod} by {host}")'),
    from: z.number().describe('Start time (POSIX epoch seconds)'),
    to: z.number().describe('End time (POSIX epoch seconds)'),
  }),
  output: z.object({
    series: z.array(metricSeriesSchema),
    from_date: z.number().describe('Query start time (epoch ms)'),
    to_date: z.number().describe('Query end time (epoch ms)'),
    query: z.string().describe('Executed query'),
  }),
  handle: async params => {
    const data = await apiGet<{
      series?: Array<Record<string, unknown>>;
      from_date?: number;
      to_date?: number;
      query?: string;
    }>('/api/v1/query', {
      from: params.from,
      to: params.to,
      query: params.query,
    });
    const series = (data.series ?? []).map(s => ({
      metric: (s.metric as string) ?? '',
      scope: (s.scope as string) ?? '',
      pointlist: (s.pointlist as Array<[number, number]>) ?? [],
      unit: (s.unit as Array<{ name: string }>) ?? null,
    }));
    return {
      series,
      from_date: data.from_date ?? 0,
      to_date: data.to_date ?? 0,
      query: data.query ?? params.query,
    };
  },
});
