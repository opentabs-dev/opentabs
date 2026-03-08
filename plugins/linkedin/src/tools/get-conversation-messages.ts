import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { encodeUrn, messagingGraphql } from '../linkedin-api.js';
import { mapMessage, messageSchema } from './schemas.js';

/** Persisted query hash for messages in a conversation — changes with LinkedIn deployments. */
const MESSAGES_QUERY_ID = 'messengerMessages.5846eeb71c981f11e0134cb6626cc314';

interface MessagesResponse {
  data?: {
    messengerMessagesBySyncToken?: {
      elements?: Array<Record<string, unknown>>;
    };
  };
}

export const getConversationMessages = defineTool({
  name: 'get_conversation_messages',
  displayName: 'Get Conversation Messages',
  description:
    'Get messages from a specific LinkedIn messaging conversation. Requires the conversation URN from list_conversations. Returns messages with sender info and timestamps.',
  summary: 'Read messages in a conversation',
  icon: 'message-square-text',
  group: 'Messaging',
  input: z.object({
    conversation_urn: z.string().describe('Conversation URN (e.g., "urn:li:msg_conversation:(...)")'),
  }),
  output: z.object({
    messages: z.array(messageSchema).describe('Messages in the conversation'),
  }),
  handle: async params => {
    const data = await messagingGraphql<MessagesResponse>(
      MESSAGES_QUERY_ID,
      `(conversationUrn:${encodeUrn(params.conversation_urn)})`,
    );

    const elements = data.data?.messengerMessagesBySyncToken?.elements ?? [];
    const messages = elements.map(el => mapMessage(el as Parameters<typeof mapMessage>[0]));

    return { messages };
  },
});
