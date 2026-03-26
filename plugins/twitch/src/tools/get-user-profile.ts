import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gql } from '../twitch-api.js';
import { userSchema, mapUser } from './schemas.js';
import type { RawUser } from './schemas.js';

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description:
    'Get a Twitch user profile by their login name. Returns display name, bio, follower count, partner/affiliate status, profile image, and account creation date.',
  summary: 'Get a Twitch user profile by login name',
  icon: 'user',
  group: 'Users',
  input: z.object({
    login: z.string().describe('Twitch login name (e.g., "shroud", "ninja")'),
  }),
  output: z.object({ user: userSchema }),
  handle: async params => {
    const data = await gql<{ user: RawUser | null }>(`{
      user(login: "${params.login.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}") {
        id login displayName description
        profileImageURL(width: 300)
        createdAt
        roles { isPartner isAffiliate }
        followers { totalCount }
      }
    }`);
    if (!data.user) throw ToolError.notFound(`User "${params.login}" not found`);
    return { user: mapUser(data.user) };
  },
});
