import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../clickup-api.js';
import { userSchema, mapUser } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description:
    'Get the profile of the currently authenticated ClickUp user including name, email, timezone, and avatar.',
  summary: 'Get the authenticated user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({}),
  output: z.object({ user: userSchema.describe('The authenticated user') }),
  handle: async () => {
    const data = await api<Record<string, unknown>>('/user/v1/user/me');
    return { user: mapUser(data) };
  },
});
