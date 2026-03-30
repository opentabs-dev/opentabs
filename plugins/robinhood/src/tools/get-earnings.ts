import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawEarnings, earningsSchema, mapEarnings } from './schemas.js';

export const getEarnings = defineTool({
  name: 'get_earnings',
  displayName: 'Get Earnings',
  description:
    'Get earnings history and estimates for a stock. Returns EPS estimates vs actuals, report dates, and report timing (before/after market).',
  summary: 'Get earnings history and estimates',
  icon: 'calendar',
  group: 'Market Data',
  input: z.object({
    symbol: z.string().describe('Ticker symbol'),
  }),
  output: z.object({
    earnings: z.array(earningsSchema).describe('Earnings reports by quarter'),
  }),
  handle: async params => {
    const data = await api<{ results: RawEarnings[] }>('/marketdata/earnings/', { query: { symbol: params.symbol } });
    return { earnings: (data.results ?? []).map(mapEarnings) };
  },
});
