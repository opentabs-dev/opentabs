import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { usersApi, getUserId } from '../lucid-api.js';
import { type RawUser, mapUser, userSchema } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description: 'Get the profile of the currently authenticated Lucid user, including name, email, and account status.',
  summary: 'Get your Lucid profile',
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: z.object({ user: userSchema }),
  handle: async () => {
    const userId = getUserId();
    const data = await usersApi<RawUser>(`/users/${userId}`);
    return { user: mapUser(data) };
  },
});
