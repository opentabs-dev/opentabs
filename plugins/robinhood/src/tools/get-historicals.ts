import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawHistorical, historicalSchema, mapHistorical } from './schemas.js';

interface HistoricalsResponse {
  results: { symbol: string; historicals: RawHistorical[] }[];
}

export const getHistoricals = defineTool({
  name: 'get_historicals',
  displayName: 'Get Historicals',
  description:
    'Get historical OHLCV price data for one or more stocks. Supports multiple intervals (5min to weekly) and spans (day to all-time). Use bounds to include extended hours data.',
  summary: 'Get historical price data for stocks',
  icon: 'chart-line',
  group: 'Market Data',
  input: z.object({
    symbols: z.string().describe('Comma-separated ticker symbols (e.g., "AAPL,TSLA")'),
    interval: z
      .enum(['5minute', '10minute', 'hour', 'day', 'week'])
      .describe('Candle interval (e.g., 5minute, hour, day)'),
    span: z
      .enum(['day', 'week', 'month', '3month', 'year', '5year', 'all'])
      .describe('Time span to retrieve (e.g., month, year, all)'),
    bounds: z
      .enum(['regular', 'extended', 'trading'])
      .default('regular')
      .describe('Trading session bounds: regular (default), extended, or trading'),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          symbol: z.string().describe('Ticker symbol'),
          historicals: z.array(historicalSchema).describe('OHLCV data points'),
        }),
      )
      .describe('Historical data grouped by symbol'),
  }),
  handle: async params => {
    const data = await api<HistoricalsResponse>('/marketdata/historicals/', {
      query: {
        symbols: params.symbols,
        interval: params.interval,
        span: params.span,
        bounds: params.bounds,
      },
    });
    return {
      results: (data.results ?? []).map(r => ({
        symbol: r.symbol ?? '',
        historicals: (r.historicals ?? []).map(mapHistorical),
      })),
    };
  },
});
