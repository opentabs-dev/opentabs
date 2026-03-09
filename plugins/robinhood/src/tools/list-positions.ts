import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RHPaginated, type RawPosition, mapPosition, positionSchema } from './schemas.js';

export const listPositions = defineTool({
  name: 'list_positions',
  displayName: 'List Positions',
  description:
    'List all nonzero stock positions in the Robinhood portfolio including instrument ID, ticker symbol, quantity, average buy price, and shares available for sale.',
  summary: 'List current stock positions',
  icon: 'layers',
  group: 'Portfolio',
  input: z.object({}),
  output: z.object({
    positions: z.array(positionSchema).describe('List of nonzero stock positions'),
  }),
  handle: async () => {
    const data = await api<RHPaginated<RawPosition>>('/positions/', {
      query: { nonzero: 'true' },
    });
    const positions = (data.results ?? []).map(mapPosition);
    return { positions };
  },
});
