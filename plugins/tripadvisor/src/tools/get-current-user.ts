import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { fetchSsrData, findSsrOperation } from '../tripadvisor-api.js';
import { userProfileSchema, mapUserProfile, type RawMemberProfile } from './schemas.js';

export const getCurrentUser = defineTool({
  name: 'get_current_user',
  displayName: 'Get Current User',
  description: 'Get the authenticated TripAdvisor user profile including display name, avatar, and inbox status.',
  summary: 'Get your TripAdvisor profile',
  icon: 'user',
  group: 'Account',
  input: z.object({}),
  output: z.object({ user: userProfileSchema }),
  handle: async () => {
    const ssrData = await fetchSsrData('/');

    const memberProfile = findSsrOperation(ssrData, 'memberProfile') as RawMemberProfile | null;
    if (!memberProfile) throw ToolError.internal('Could not find member profile in SSR data.');

    const unread = findSsrOperation(ssrData, 'Inbox_unreadConversations') as boolean | null;

    // Extract userId from bootstrap — it's in the outer bootstrap, not SSR data
    // We use the cookie-based auth userId
    const userId =
      (
        findSsrOperation(ssrData, 'currentMember') as {
          userId?: string;
        } | null
      )?.userId ?? '';

    return {
      user: mapUserProfile(memberProfile, userId, unread ?? false),
    };
  },
});
