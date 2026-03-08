import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getMyProfileUrn, messagingAction } from '../linkedin-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    'Send a message in an existing LinkedIn messaging conversation. Requires the conversation URN from list_conversations. The message is sent as the authenticated user.',
  summary: 'Send a message in a conversation',
  icon: 'send',
  group: 'Messaging',
  input: z.object({
    conversation_urn: z
      .string()
      .describe('Conversation URN to send the message in (e.g., "urn:li:msg_conversation:(...)")'),
    text: z.string().describe('Message text to send'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent successfully'),
  }),
  handle: async params => {
    const profileUrn = await getMyProfileUrn();

    await messagingAction('/voyagerMessagingDashMessengerMessages?action=createMessage', {
      dedupeByClientGeneratedToken: false,
      hostUrn: profileUrn,
      message: {
        body: {
          attributes: [],
          text: params.text,
        },
        conversationUrn: params.conversation_urn,
        originToken: crypto.randomUUID(),
        renderContentUnions: [],
      },
    });

    return { success: true };
  },
});
