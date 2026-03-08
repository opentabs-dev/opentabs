import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../linkedin-api.js';
import { type RawMeResponse, currentUserSchema, mapCurrentUser } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    'Get the authenticated LinkedIn user profile including name, headline, public identifier, and profile picture.',
  summary: 'Get the current authenticated user',
  icon: 'user',
  group: 'Profile',
  input: z.object({}),
  output: z.object({
    user: currentUserSchema.describe('Current user profile'),
  }),
  handle: async () => {
    const data = await api<RawMeResponse>('/me');
    return { user: mapCurrentUser(data) };
  },
});
