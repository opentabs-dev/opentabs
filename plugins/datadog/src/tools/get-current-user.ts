import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { userSchema, mapUser } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description: 'Get the profile of the currently authenticated Datadog user.',
  summary: 'Get current user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({}),
  output: z.object({
    user: userSchema,
  }),
  handle: async () => {
    const data = await apiGet<{ data?: Record<string, unknown> }>('/api/v2/current_user');
    return { user: mapUser(data.data ?? {}) };
  },
});
