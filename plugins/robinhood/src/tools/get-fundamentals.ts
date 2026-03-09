import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawFundamentals, fundamentalsSchema, mapFundamentals } from './schemas.js';

export const getFundamentals = defineTool({
  name: 'get_fundamentals',
  displayName: 'Get Fundamentals',
  description:
    'Get fundamental financial data for a stock including market cap, P/E ratio, dividend yield, 52-week range, volume, and company description.',
  summary: 'Get fundamental financial data for a stock',
  icon: 'bar-chart-3',
  group: 'Market Data',
  input: z.object({
    symbol: z.string().describe('Ticker symbol'),
  }),
  output: z.object({
    fundamentals: fundamentalsSchema.describe('Fundamental financial data'),
  }),
  handle: async params => {
    const data = await api<RawFundamentals>(`/fundamentals/${params.symbol}/`);
    return { fundamentals: mapFundamentals(data) };
  },
});
