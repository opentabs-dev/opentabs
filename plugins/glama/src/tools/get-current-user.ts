import { ToolError, defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getCurrentRouteData } from '../glama-api.js';
import { type RawVisitorSession, mapUserProfile, userProfileSchema } from './schemas.js';

interface RootRouteData {
  visitor?: {
    visitorSession?: RawVisitorSession;
  };
}

export const getCurrentUserTool = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description: "Get the authenticated user's profile including email, name, workspace, and role.",
  summary: "Get the authenticated user's profile",
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    user: userProfileSchema.describe('Authenticated user profile'),
  }),
  handle: async () => {
    const data = getCurrentRouteData<RootRouteData>('root');
    const session = data?.visitor?.visitorSession;

    if (!session) {
      throw ToolError.auth('Not authenticated — please log in to Glama.');
    }

    return { user: mapUserProfile(session) };
  },
});
