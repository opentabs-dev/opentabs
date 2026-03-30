import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawInstrument, instrumentSchema, mapInstrument } from './schemas.js';

export const searchInstruments = defineTool({
  name: 'search_instruments',
  displayName: 'Search Instruments',
  description:
    'Search for stocks and other instruments by company name or ticker symbol. Returns matching instruments with UUID, symbol, name, type, and tradeability.',
  summary: 'Search instruments by name or ticker',
  icon: 'search',
  group: 'Market Data',
  input: z.object({
    query: z.string().describe('Search query (company name or ticker symbol)'),
  }),
  output: z.object({
    instruments: z.array(instrumentSchema).describe('Matching instruments'),
  }),
  handle: async params => {
    const data = await api<{ results: RawInstrument[] }>('/instruments/', { query: { query: params.query } });
    return { instruments: (data.results ?? []).map(mapInstrument) };
  },
});
