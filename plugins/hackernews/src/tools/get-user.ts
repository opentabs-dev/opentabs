import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchUser } from '../hackernews-api.js';
import { userSchema, mapUser } from './schemas.js';

export const getUser = defineTool({
  name: 'get_user',
  displayName: 'Get User',
  description:
    'Get a Hacker News user profile by username. Returns karma, creation date, and bio. Usernames are case-sensitive.',
  summary: 'Get a user profile by username',
  icon: 'user',
  group: 'Users',
  input: z.object({
    username: z.string().min(1).describe('Username (case-sensitive)'),
  }),
  output: z.object({ user: userSchema }),
  handle: async params => {
    const data = await fetchUser(params.username);
    return { user: mapUser(data) };
  },
});
