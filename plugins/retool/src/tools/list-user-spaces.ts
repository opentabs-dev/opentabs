import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapUserSpace, type RawUserSpace, userSpaceSchema } from './schemas.js';

export const listUserSpaces = defineTool({
  name: 'list_user_spaces',
  displayName: 'List User Spaces',
  description:
    'List all spaces (workspaces) accessible to the current user. Spaces represent separate Retool organizations or child organizations.',
  summary: 'List accessible user spaces',
  icon: 'layout-dashboard',
  group: 'Organization',
  input: z.object({}),
  output: z.object({
    spaces: z.array(userSpaceSchema).describe('List of user spaces'),
  }),
  handle: async () => {
    const data = await api<{ userSpaces: RawUserSpace[] }>('/api/organization/userSpaces');
    return { spaces: (data.userSpaces ?? []).map(mapUserSpace) };
  },
});
