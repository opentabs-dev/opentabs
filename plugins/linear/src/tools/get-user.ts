import { graphql } from '../linear-api.js';
import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { mapUser, userSchema } from './schemas.js';

export const getUser = defineTool({
  name: 'get_user',
  displayName: 'Get User',
  description: 'Get detailed information about a single Linear user by their UUID.',
  summary: 'Get details of a single user',
  icon: 'user',
  group: 'Teams & Users',
  input: z.object({
    user_id: z.string().describe('User UUID'),
  }),
  output: z.object({
    user: userSchema.describe('The requested user'),
  }),
  handle: async params => {
    const data = await graphql<{ user: Record<string, unknown> }>(
      `query GetUser($id: String!) {
        user(id: $id) {
          id name email displayName active admin
        }
      }`,
      { id: params.user_id },
    );

    if (!data.user) throw ToolError.notFound('User not found');

    return { user: mapUser(data.user as Parameters<typeof mapUser>[0]) };
  },
});
