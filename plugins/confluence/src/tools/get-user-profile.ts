import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV1, getAccountId } from '../confluence-api.js';

const userProfileSchema = z.object({
  account_id: z.string().describe('Atlassian account ID'),
  display_name: z.string().describe('User display name'),
  public_name: z.string().describe('User public name'),
  email: z.string().describe('User email address'),
  account_type: z.string().describe('Account type (e.g., "atlassian")'),
  account_status: z.string().describe('Account status (e.g., "active")'),
  avatar_url: z.string().describe('Relative URL to user avatar image'),
});

interface RawUser {
  accountId?: string;
  displayName?: string;
  publicName?: string;
  email?: string;
  accountType?: string;
  accountStatus?: string;
  profilePicture?: { path?: string };
}

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description:
    'Get a Confluence user profile by account ID. If no account ID is provided, returns the current user profile.',
  summary: 'Get a user profile',
  icon: 'user',
  group: 'Users',
  input: z.object({
    account_id: z.string().optional().describe('Atlassian account ID — omit to get the current user profile'),
  }),
  output: z.object({
    user: userProfileSchema.describe('User profile information'),
  }),
  handle: async params => {
    const accountId = params.account_id ?? getAccountId();
    const data = await apiV1<RawUser>('/user', {
      query: { accountId },
    });

    return {
      user: {
        account_id: data.accountId ?? '',
        display_name: data.displayName ?? '',
        public_name: data.publicName ?? '',
        email: data.email ?? '',
        account_type: data.accountType ?? '',
        account_status: data.accountStatus ?? '',
        avatar_url: data.profilePicture?.path ?? '',
      },
    };
  },
});
