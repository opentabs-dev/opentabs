import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../linkedin-api.js';
import { mapProfile, profileSchema } from './schemas.js';

interface ProfileResponse {
  elements?: Array<Record<string, unknown>>;
}

export const getUserProfile = defineTool({
  name: 'get_user_profile',
  displayName: 'Get User Profile',
  description:
    'Get a LinkedIn user profile by their public identifier (the slug from their profile URL, e.g., "williamhgates" for linkedin.com/in/williamhgates). Returns name, headline, location, and profile picture.',
  summary: "Get a user's LinkedIn profile",
  icon: 'user-search',
  group: 'Profile',
  input: z.object({
    public_identifier: z
      .string()
      .describe('Public profile identifier — the slug from the LinkedIn profile URL (e.g., "williamhgates")'),
  }),
  output: z.object({
    profile: profileSchema.describe('User profile'),
  }),
  handle: async params => {
    const data = await api<ProfileResponse>('/identity/dash/profiles', {
      query: {
        q: 'memberIdentity',
        memberIdentity: params.public_identifier,
        decorationId: 'com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-18',
      },
    });

    const element = data.elements?.[0];
    if (!element) {
      throw ToolError.notFound(`Profile not found: ${params.public_identifier}`);
    }

    return {
      profile: mapProfile(element as Parameters<typeof mapProfile>[0]),
    };
  },
});
