import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapUser, type RawUser, userSchema } from './schemas.js';

export const changeUserName = defineTool({
  name: 'change_user_name',
  displayName: 'Change User Name',
  description: 'Update the first and last name of the currently authenticated user.',
  summary: 'Change the current user name',
  icon: 'user-pen',
  group: 'Users',
  input: z.object({
    first_name: z.string().describe('New first name'),
    last_name: z.string().describe('New last name'),
  }),
  output: z.object({ user: userSchema }),
  handle: async params => {
    const data = await api<{ user: RawUser }>('/api/user/changeName', {
      method: 'POST',
      body: {
        firstName: params.first_name,
        lastName: params.last_name,
      },
    });
    return { user: mapUser(data.user ?? {}) };
  },
});
