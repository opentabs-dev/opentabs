import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiUiPost } from '../datadog-api.js';

export const queryTimeseries = defineTool({
  name: 'query_timeseries',
  displayName: 'Query Timeseries',
  description:
    'Execute a multi-query timeseries request using the Datadog internal query engine. Supports metrics, logs, spans, and other data sources with formula support.',
  summary: 'Run advanced timeseries queries with formulas',
  icon: 'trending-up',
  group: 'Metrics',
  input: z.object({
    queries: z
      .array(
        z.object({
          data_source: z.enum(['metrics', 'logs', 'spans', 'rum']).describe('Data source'),
          query: z.string().describe('Query string'),
          name: z.string().describe('Query reference name (e.g., "a", "b")'),
        }),
      )
      .describe('Array of queries to execute'),
    from: z.number().describe('Start time (epoch milliseconds)'),
    to: z.number().describe('End time (epoch milliseconds)'),
    formulas: z
      .array(z.object({ formula: z.string().describe('Formula expression (e.g., "a + b", "a / b * 100")') }))
      .optional()
      .describe('Optional formulas combining query results'),
  }),
  output: z.object({
    data: z.unknown().describe('Timeseries result data'),
    meta: z.unknown().describe('Query metadata'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      queries: params.queries,
      from: params.from,
      to: params.to,
    };
    if (params.formulas?.length) body.formulas = params.formulas;

    const data = await apiUiPost<{ data?: unknown; meta?: unknown }>('/query/timeseries', body);
    return { data: data.data ?? null, meta: data.meta ?? null };
  },
});
