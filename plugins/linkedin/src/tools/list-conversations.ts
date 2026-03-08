import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { encodeUrn, getMyProfileUrn, messagingGraphql } from '../linkedin-api.js';
import { conversationSchema, mapConversation } from './schemas.js';

/** Persisted query hash for listing conversations — changes with LinkedIn deployments. */
const CONVERSATIONS_QUERY_ID = 'messengerConversations.0d5e6781bbee71c3e51c8843c6519f48';

interface ConversationsResponse {
  data?: {
    messengerConversationsBySyncToken?: {
      elements?: Array<Record<string, unknown>>;
    };
  };
}

export const listConversations = defineTool({
  name: 'list_conversations',
  displayName: 'List Conversations',
  description:
    'List recent messaging conversations from the LinkedIn inbox. Returns conversations with participant names, last message preview, and read status. Results are ordered by most recent activity.',
  summary: 'List messaging conversations',
  icon: 'messages-square',
  group: 'Messaging',
  input: z.object({}),
  output: z.object({
    conversations: z.array(conversationSchema).describe('List of recent conversations'),
  }),
  handle: async () => {
    const profileUrn = await getMyProfileUrn();

    const data = await messagingGraphql<ConversationsResponse>(
      CONVERSATIONS_QUERY_ID,
      `(mailboxUrn:${encodeUrn(profileUrn)})`,
    );

    const elements = data.data?.messengerConversationsBySyncToken?.elements ?? [];
    const conversations = elements.map(el => mapConversation(el as Parameters<typeof mapConversation>[0]));

    return { conversations };
  },
});
