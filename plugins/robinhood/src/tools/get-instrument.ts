import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawInstrument, instrumentSchema, mapInstrument } from './schemas.js';

export const getInstrument = defineTool({
  name: 'get_instrument',
  displayName: 'Get Instrument',
  description:
    'Get detailed instrument information by UUID including ticker symbol, company name, type, country, tradeability, and listing date.',
  summary: 'Get instrument details by UUID',
  icon: 'info',
  group: 'Market Data',
  input: z.object({
    instrument_id: z.string().describe('Instrument UUID'),
  }),
  output: z.object({
    instrument: instrumentSchema.describe('Instrument details'),
  }),
  handle: async params => {
    const data = await api<RawInstrument>(`/instruments/${params.instrument_id}/`);
    return { instrument: mapInstrument(data) };
  },
});
