import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawUser, userSchema, mapUser } from './schemas.js';

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description: 'Get the profile of the currently authenticated Bitbucket user.',
  summary: 'Get current user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({}),
  output: userSchema,
  handle: async () => {
    const data = await api<RawUser>('/user');
    return mapUser(data);
  },
});
