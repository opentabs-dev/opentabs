import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RHPaginated, type RawAccount, accountSchema, mapAccount } from './schemas.js';

export const getAccount = defineTool({
  name: 'get_account',
  displayName: 'Get Account',
  description:
    'Get the Robinhood brokerage account details including account number, type, buying power, cash balance, and withdrawal availability.',
  summary: 'Get brokerage account details',
  icon: 'wallet',
  group: 'Account',
  input: z.object({}),
  output: accountSchema,
  handle: async () => {
    const data = await api<RHPaginated<RawAccount>>('/accounts/');
    const account = data.results?.[0] ?? {};
    return mapAccount(account);
  },
});
