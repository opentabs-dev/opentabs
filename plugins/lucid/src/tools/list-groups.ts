import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { usersApi, getUserId } from '../lucid-api.js';
import { type RawGroup, mapGroup, groupSchema } from './schemas.js';

export const listGroups = defineTool({
  name: 'list_groups',
  displayName: 'List Groups',
  description: 'List all teams/groups the current user belongs to. Groups organize users within a Lucid account.',
  summary: 'List your teams and groups',
  icon: 'users',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    groups: z.array(groupSchema),
  }),
  handle: async () => {
    const userId = getUserId();
    const data = await usersApi<RawGroup[]>('/groups', {
      query: { userId },
    });
    return { groups: data.map(mapGroup) };
  },
});
