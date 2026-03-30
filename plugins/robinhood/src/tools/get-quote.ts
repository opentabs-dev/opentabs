import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawQuote, quoteSchema, mapQuote } from './schemas.js';

export const getQuote = defineTool({
  name: 'get_quote',
  displayName: 'Get Quote',
  description:
    'Get real-time stock quotes for one or more ticker symbols. Returns bid/ask prices, last trade price, previous close, and trading halt status.',
  summary: 'Get real-time stock quotes',
  icon: 'candlestick-chart',
  group: 'Market Data',
  input: z.object({
    symbols: z.string().describe('Comma-separated ticker symbols (e.g., "AAPL,TSLA,MSFT")'),
  }),
  output: z.object({
    quotes: z.array(quoteSchema).describe('List of stock quotes'),
  }),
  handle: async params => {
    const data = await api<{ results: RawQuote[] }>('/marketdata/quotes/', { query: { symbols: params.symbols } });
    return { quotes: (data.results ?? []).map(mapQuote) };
  },
});
