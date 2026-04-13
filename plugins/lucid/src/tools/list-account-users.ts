import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { usersApi, getAccountId } from '../lucid-api.js';

export const listAccountUsers = defineTool({
  name: 'list_account_users',
  displayName: 'List Account Users',
  description:
    'List all user URIs in the current Lucid account. Returns user resource URIs that can be used to fetch individual user profiles.',
  summary: 'List users in the account',
  icon: 'users',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    user_uris: z.array(z.string()).describe('Array of user resource URIs'),
    count: z.number().int().describe('Number of users'),
  }),
  handle: async () => {
    const accountId = getAccountId();
    const data = await usersApi<string[]>(`/accounts/${accountId}/userList`);
    return { user_uris: data, count: data.length };
  },
});
