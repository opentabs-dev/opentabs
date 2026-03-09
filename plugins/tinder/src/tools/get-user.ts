import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawUser, mapUser, userSchema } from './schemas.js';

export const getUser = defineTool({
  name: 'get_user',
  displayName: 'Get User',
  description: "Get another user's profile by their user ID. Returns name, bio, photos, and distance.",
  summary: 'Get a user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({
    user_id: z.string().describe('User ID to look up'),
  }),
  output: z.object({
    user: userSchema.describe('User profile'),
  }),
  handle: async params => {
    const data = await api<{ results: RawUser }>(`/user/${params.user_id}`);
    return { user: mapUser(data.results) };
  },
});
