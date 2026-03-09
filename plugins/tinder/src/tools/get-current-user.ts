import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawProfile, type TinderResponse, mapProfile, profileSchema } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    "Get the authenticated user's Tinder profile including name, bio, photos, preferences (age range, distance, gender filter), jobs, schools, and interests.",
  summary: 'Get your Tinder profile',
  icon: 'user',
  group: 'Profile',
  input: z.object({}),
  output: z.object({ profile: profileSchema.describe('Authenticated user profile') }),
  handle: async () => {
    const data = await api<TinderResponse<{ user: RawProfile }>>('/v2/profile', {
      query: { include: 'user' },
    });
    return { profile: mapProfile(data.data?.user ?? {}) };
  },
});
