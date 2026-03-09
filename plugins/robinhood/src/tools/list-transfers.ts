import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import type { RHPaginated } from './schemas.js';
import { type RawTransfer, mapTransfer, transferSchema } from './schemas.js';

export const listTransfers = defineTool({
  name: 'list_transfers',
  displayName: 'List Transfers',
  description:
    'List ACH bank transfers including deposits and withdrawals with their amounts, directions, states, and expected landing dates.',
  summary: 'List ACH bank transfers',
  icon: 'arrow-left-right',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    transfers: z.array(transferSchema).describe('List of ACH transfers'),
  }),
  handle: async () => {
    const data = await api<RHPaginated<RawTransfer>>('/ach/transfers/');
    const transfers = (data.results ?? []).map(mapTransfer);
    return { transfers };
  },
});
