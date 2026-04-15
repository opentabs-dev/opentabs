import { ToolError, fetchFromPage } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getLogin, isAuthenticated } from '../github-api.js';
import { mapUser, userSchema } from './schemas.js';

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description: "Get a GitHub user's profile. Defaults to the authenticated user if no username is provided.",
  summary: "Get a user's profile information",
  icon: 'user',
  group: 'Users',
  input: z.object({
    username: z.string().optional().describe('GitHub username — defaults to the authenticated user'),
  }),
  output: z.object({
    user: userSchema.describe('User profile'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');
    const username = params.username ?? getLogin();

    // User profiles are public — use api.github.com without credentials
    const response = await fetchFromPage(`https://api.github.com/users/${username}`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
    });
    const data = await response.json();
    return { user: mapUser(data as Record<string, unknown>) };
  },
});
