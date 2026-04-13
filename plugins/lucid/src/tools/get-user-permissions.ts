import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { usersApi, getUserId } from '../lucid-api.js';

interface RawPermissions {
  permissions?: string[];
}

export const getUserPermissions = defineTool({
  name: 'get_user_permissions',
  displayName: 'Get User Permissions',
  description:
    'Get the list of permissions granted to the current user in their Lucid account. Permissions control access to features like admin, templates, integrations, and document management.',
  summary: 'Get your account permissions',
  icon: 'shield-check',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    permissions: z.array(z.string()).describe('List of permission names'),
  }),
  handle: async () => {
    const userId = getUserId();
    const data = await usersApi<RawPermissions>(`/users/${userId}/permissions`);
    return { permissions: data.permissions ?? [] };
  },
});
