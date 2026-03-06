import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { discordApi } from '../discord-api.js';

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description: 'Get a Discord user\'s profile by their user ID. Use "@me" for the authenticated user.',
  summary: "Get a user's profile information",
  icon: 'user',
  group: 'Users',
  input: z.object({
    user_id: z.string().min(1).describe('User ID to look up, or "@me" for the authenticated user'),
  }),
  output: z.object({
    user: z.object({
      id: z.string().describe('User ID'),
      username: z.string().describe('Username'),
      global_name: z.string().nullable().describe('Display name'),
      avatar: z.string().nullable().describe('Avatar hash'),
      banner: z.string().nullable().describe('Banner hash'),
      bio: z.string().describe('User bio'),
      bot: z.boolean().describe('Whether the user is a bot'),
      email: z.string().nullable().describe('Email (only available for @me)'),
      verified: z.boolean().describe('Whether the email is verified'),
      mfa_enabled: z.boolean().describe('Whether 2FA is enabled'),
      locale: z.string().nullable().describe('User locale'),
    }),
  }),
  handle: async params => {
    const endpoint = params.user_id === '@me' ? '/users/@me' : `/users/${params.user_id}`;
    const data = await discordApi<Record<string, unknown>>(endpoint);

    return {
      user: {
        id: (data.id as string) ?? '',
        username: (data.username as string) ?? '',
        global_name: (data.global_name as string | null) ?? null,
        avatar: (data.avatar as string | null) ?? null,
        banner: (data.banner as string | null) ?? null,
        bio: (data.bio as string) ?? '',
        bot: (data.bot as boolean) ?? false,
        email: (data.email as string | null) ?? null,
        verified: (data.verified as boolean) ?? false,
        mfa_enabled: (data.mfa_enabled as boolean) ?? false,
        locale: (data.locale as string | null) ?? null,
      },
    };
  },
});
