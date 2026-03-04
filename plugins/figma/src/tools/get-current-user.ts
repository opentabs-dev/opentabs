import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { figmaApi, getAuthContext } from '../figma-api.js';
import type { RawUser } from './schemas.js';
import { mapUser, userSchema } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description: 'Get the profile of the currently authenticated Figma user',
  summary: 'Get the current user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({}),
  output: z.object({
    user: userSchema.describe('Current user profile'),
  }),
  handle: async () => {
    const { fuid } = getAuthContext();
    const data = await figmaApi<{ meta?: { users?: RawUser[] } }>('/session/state', {
      query: { fuid },
    });
    const users = data.meta?.users ?? [];
    const me = users.find(u => u.id === fuid) ?? users[0];
    if (!me) throw ToolError.notFound('User not found in session state');
    return { user: mapUser(me) };
  },
});
