import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { usersApi, getAccountId } from '../lucid-api.js';
import { type RawAccount, mapAccount, accountSchema } from './schemas.js';

export const getAccount = defineTool({
  name: 'get_account',
  displayName: 'Get Account',
  description: 'Get details about the current Lucid account, including name, user count, and creation date.',
  summary: 'Get account details',
  icon: 'building-2',
  group: 'Account',
  input: z.object({}),
  output: z.object({ account: accountSchema }),
  handle: async () => {
    const accountId = getAccountId();
    const data = await usersApi<RawAccount>(`/accounts/${accountId}`);
    return { account: mapAccount(data) };
  },
});
