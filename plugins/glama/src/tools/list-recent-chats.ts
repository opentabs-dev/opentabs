import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { navigateAndLoad } from '../glama-api.js';
import { type RawChatSessionSummary, chatSessionSummarySchema, mapChatSessionSummary } from './schemas.js';

interface AppLayoutData {
  recentChatSessions?: RawChatSessionSummary[];
}

export const listRecentChatsTool = defineTool({
  name: 'list_recent_chats',
  displayName: 'List Recent Chats',
  description: 'List recent chat sessions from the sidebar, including their UIDs and titles.',
  summary: 'List recent chat sessions',
  icon: 'message-square',
  group: 'Chat',
  input: z.object({}),
  output: z.object({
    chats: z.array(chatSessionSummarySchema).describe('Recent chat sessions'),
  }),
  handle: async () => {
    const data = await navigateAndLoad<AppLayoutData>('/chat', 'routes/_authenticated/_app/_layout', {
      requireAuth: true,
    });

    const chats = (data.recentChatSessions ?? []).map(mapChatSessionSummary);
    return { chats };
  },
});
