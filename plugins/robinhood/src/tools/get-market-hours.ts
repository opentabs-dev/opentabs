import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawMarketHours, mapMarketHours, marketHoursSchema } from './schemas.js';

export const getMarketHours = defineTool({
  name: 'get_market_hours',
  displayName: 'Get Market Hours',
  description: 'Get market trading hours for a specific date including open/close times and extended hours windows.',
  summary: 'Get market hours for a date',
  icon: 'clock',
  group: 'Market Data',
  input: z.object({
    market: z.string().optional().describe('Market MIC code (default XNYS for NYSE)'),
    date: z.string().describe('Date to check in YYYY-MM-DD format'),
  }),
  output: z.object({
    hours: marketHoursSchema.describe('Market hours for the requested date'),
  }),
  handle: async params => {
    const market = params.market || 'XNYS';
    const data = await api<RawMarketHours>(`/markets/${market}/hours/${params.date}/`);
    return { hours: mapMarketHours(data) };
  },
});
