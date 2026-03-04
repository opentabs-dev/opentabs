import { mapUser, userSchema } from './schemas.js';
import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetSpacesResponse {
  [userId: string]: {
    notion_user?: Record<string, { value?: Record<string, unknown> }>;
    space_user?: Record<string, { value?: Record<string, unknown> }>;
  };
}

export const listUsers = defineTool({
  name: 'list_users',
  displayName: 'List Users',
  description: 'List all users (members) in the current Notion workspace',
  summary: 'List workspace members',
  icon: 'users',
  group: 'Users',
  input: z.object({}),
  output: z.object({
    users: z.array(userSchema).describe('Workspace members'),
  }),
  handle: async () => {
    await getSpaceId(); // ensure spaceId is resolved

    const data = await notionApi<GetSpacesResponse>('getSpaces', {});

    const users: ReturnType<typeof mapUser>[] = [];
    for (const userEntry of Object.values(data)) {
      if (userEntry.notion_user) {
        for (const u of Object.values(userEntry.notion_user)) {
          if (u.value) {
            users.push(mapUser(u.value as Record<string, unknown>));
          }
        }
      }
    }

    return { users };
  },
});
