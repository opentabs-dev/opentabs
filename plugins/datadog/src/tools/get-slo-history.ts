import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getSloHistory = defineTool({
  name: 'get_slo_history',
  displayName: 'Get SLO History',
  description:
    'Get historical SLO data for a specific timeframe. Returns SLI values, error budget remaining, and uptime data.',
  summary: 'Get SLO history and error budget',
  icon: 'history',
  group: 'SLOs',
  input: z.object({
    slo_id: z.string().describe('SLO ID'),
    from_ts: z.number().describe('Start timestamp (POSIX epoch seconds)'),
    to_ts: z.number().describe('End timestamp (POSIX epoch seconds)'),
  }),
  output: z.object({
    overall: z.object({
      sli_value: z.number().nullable().describe('SLI value for the period'),
      span_precision: z.number().describe('Precision of the timespan'),
      name: z.string().describe('SLO name'),
    }),
    series: z.object({
      numerator: z.object({ count: z.number(), sum: z.number() }),
      denominator: z.object({ count: z.number(), sum: z.number() }),
    }),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/slo/${params.slo_id}/history`, {
      from_ts: params.from_ts,
      to_ts: params.to_ts,
    });
    const overall = (data.data as Record<string, unknown>) ?? {};
    const overallObj = (overall.overall as Record<string, unknown>) ?? {};
    const series = (overall.series as Record<string, unknown>) ?? {};
    const num = (series.numerator as Record<string, unknown>) ?? {};
    const den = (series.denominator as Record<string, unknown>) ?? {};

    return {
      overall: {
        sli_value: (overallObj.sli_value as number) ?? null,
        span_precision: (overallObj.span_precision as number) ?? 0,
        name: (overallObj.name as string) ?? '',
      },
      series: {
        numerator: { count: (num.count as number) ?? 0, sum: (num.sum as number) ?? 0 },
        denominator: { count: (den.count as number) ?? 0, sum: (den.sum as number) ?? 0 },
      },
    };
  },
});
