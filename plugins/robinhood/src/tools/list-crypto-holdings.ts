import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { nummusApi } from '../robinhood-api.js';
import { type RawCryptoHolding, cryptoHoldingSchema, mapCryptoHolding } from './schemas.js';

export const listCryptoHoldings = defineTool({
  name: 'list_crypto_holdings',
  displayName: 'List Crypto Holdings',
  description:
    'List all cryptocurrency holdings with nonzero quantity including currency code, total quantity, cost basis, and available quantity for trading.',
  summary: 'List current crypto holdings',
  icon: 'bitcoin',
  group: 'Portfolio',
  input: z.object({}),
  output: z.object({
    holdings: z.array(cryptoHoldingSchema).describe('List of nonzero cryptocurrency holdings'),
  }),
  handle: async () => {
    const data = await nummusApi<{ results?: RawCryptoHolding[] }>('/holdings/');
    const all = (data.results ?? []).map(mapCryptoHolding);
    const holdings = all.filter(h => Number.parseFloat(h.quantity) !== 0);
    return { holdings };
  },
});
