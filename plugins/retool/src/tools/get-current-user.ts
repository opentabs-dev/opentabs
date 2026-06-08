import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapUser, type RawUser, userSchema } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    'Get the profile of the currently authenticated Retool user, including email, name, organization, and account details.',
  summary: 'Get the authenticated user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({}),
  output: z.object({ user: userSchema }),
  handle: async () => {
    const data = await api<{ user: RawUser }>('/api/user');
    return { user: mapUser(data.user ?? {}) };
  },
});
