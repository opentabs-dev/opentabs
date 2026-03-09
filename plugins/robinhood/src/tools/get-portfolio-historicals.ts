import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { bonfireApi, getAccountNumber } from '../robinhood-api.js';

interface BonfirePoint {
  cursor_data?: {
    primary_value?: { value?: string };
  };
}

interface BonfireSegment {
  points?: BonfirePoint[];
}

interface BonfireLine {
  segments?: BonfireSegment[];
}

interface BonfirePerformanceResponse {
  lines?: BonfireLine[];
}

export const getPortfolioHistoricals = defineTool({
  name: 'get_portfolio_historicals',
  displayName: 'Get Portfolio Historicals',
  description:
    'Get historical portfolio performance data points over a configurable time span and interval. Returns a series of value snapshots useful for charting portfolio growth.',
  summary: 'Get historical portfolio performance',
  icon: 'chart-line',
  group: 'Portfolio',
  input: z.object({
    span: z
      .enum(['day', 'week', 'month', '3month', 'year', 'all'])
      .default('month')
      .describe('Time span for historical data'),
    interval: z.enum(['5minute', '10minute', 'day', 'week']).default('day').describe('Data point interval granularity'),
    bounds: z.enum(['regular', 'extended', 'trading']).default('regular').describe('Trading session bounds to include'),
  }),
  output: z.object({
    points: z
      .array(
        z.object({
          timestamp: z.number().describe('Point index in the series'),
          value: z.string().describe('Portfolio value at this point in USD'),
        }),
      )
      .describe('Portfolio performance data points'),
  }),
  handle: async params => {
    const accountNumber = await getAccountNumber();
    const data = await bonfireApi<BonfirePerformanceResponse>(`/portfolio/performance/${accountNumber}`, {
      query: {
        span: params.span,
        interval: params.interval,
        bounds: params.bounds,
      },
    });

    const line = data.lines?.[0];
    const segment = line?.segments?.[0];
    const rawPoints = segment?.points ?? [];

    const points = rawPoints.map((point, index) => ({
      timestamp: index,
      value: point.cursor_data?.primary_value?.value ?? '',
    }));

    return { points };
  },
});
