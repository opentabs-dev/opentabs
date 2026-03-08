import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

const userProfileSchema = z.object({
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  email: z.string().describe('Email address'),
  phone: z.string().describe('Phone number'),
  is_loyalty_member: z.boolean().describe('Whether the user is a Panda Rewards member'),
});

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description:
    "Get the currently logged-in user's profile information including name, email, phone, and loyalty membership status.",
  summary: 'View your Panda Express account info',
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    profile: userProfileSchema.describe('User profile details'),
  }),
  handle: async () => {
    try {
      const root = localStorage.getItem('persist:root');
      if (!root) throw ToolError.auth('Not authenticated — please log in.');
      const parsed = JSON.parse(root) as Record<string, string>;
      const appState = JSON.parse(parsed.appState ?? '{}') as {
        authentication?: {
          firstname?: string;
          lastname?: string;
          emailaddress?: string;
          phone?: string;
        };
        isLoyaltyMode?: boolean;
      };
      const auth = appState.authentication;
      if (!auth) throw ToolError.auth('Not authenticated — please log in.');
      return {
        profile: {
          first_name: auth.firstname ?? '',
          last_name: auth.lastname ?? '',
          email: auth.emailaddress ?? '',
          phone: auth.phone ?? '',
          is_loyalty_member: appState.isLoyaltyMode ?? false,
        },
      };
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw ToolError.auth('Not authenticated — please log in.');
    }
  },
});
