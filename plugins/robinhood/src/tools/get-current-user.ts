import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawUser, mapUser, userSchema } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    'Get the authenticated Robinhood user profile including username, email, name, and account creation date.',
  summary: 'Get current Robinhood user profile',
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: userSchema,
  handle: async () => {
    const data = await api<RawUser>('/user/');
    return mapUser(data);
  },
});
