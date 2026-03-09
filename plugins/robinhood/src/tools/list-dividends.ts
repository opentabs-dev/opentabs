import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import type { RHPaginated } from './schemas.js';
import { type RawDividend, dividendSchema, mapDividend } from './schemas.js';

export const listDividends = defineTool({
  name: 'list_dividends',
  displayName: 'List Dividends',
  description:
    'List dividend payments received on the Robinhood account including amount, rate, state, and payment dates.',
  summary: 'List dividend payments',
  icon: 'banknote',
  group: 'Portfolio',
  input: z.object({}),
  output: z.object({
    dividends: z.array(dividendSchema).describe('List of dividend payments'),
  }),
  handle: async () => {
    const data = await api<RHPaginated<RawDividend>>('/dividends/');
    const dividends = (data.results ?? []).map(mapDividend);
    return { dividends };
  },
});
