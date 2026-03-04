import { mapUser, userSchema } from './schemas.js';
import { getUserId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const getUser = defineTool({
  name: 'get_user',
  displayName: 'Get User',
  description: 'Get profile information for the current authenticated Notion user or a specific user by ID',
  summary: "Get a user's profile",
  icon: 'user',
  group: 'Users',
  input: z.object({
    user_id: z.string().optional().describe('User ID (UUID). If omitted, returns the current user.'),
  }),
  output: z.object({
    user: userSchema.describe('User profile information'),
  }),
  handle: async params => {
    const userId = params.user_id ?? getUserId();

    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: userId, table: 'notion_user' }],
    });

    const userData = result.results?.[0]?.value;
    return { user: mapUser(userData as Record<string, unknown> | undefined) };
  },
});
