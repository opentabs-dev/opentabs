import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { userSchema, mapUser } from './schemas.js';

export const getUser = defineTool({
  name: 'get_user',
  displayName: 'Get User',
  description: 'Get detailed information about a specific user by UUID.',
  summary: 'Get a user by UUID',
  icon: 'user',
  group: 'Users',
  input: z.object({
    user_id: z.string().describe('User UUID'),
  }),
  output: z.object({ user: userSchema }),
  handle: async params => {
    const data = await apiGet<{ data?: Record<string, unknown> }>(`/api/v2/users/${params.user_id}`);
    return { user: mapUser(data.data ?? {}) };
  },
});
