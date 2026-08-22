import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { startConversation as startConversationFromComposer } from '../conversation-messaging.js';
import { messageSubmissionSchema } from './schemas.js';

export const startConversation = defineTool({
  name: 'start_conversation',
  displayName: 'Start Conversation',
  description:
    "Start an ordinary ChatGPT conversation by submitting its first Markdown message through ChatGPT's own composer. The selected ChatGPT tab is switched to New chat when necessary. The tool returns once ChatGPT accepts the message and exposes the conversation ID; assistant generation and automatic title generation continue independently. It refuses to leave a tab containing an unsent draft.",
  summary: 'Start an ordinary conversation',
  icon: 'message-square-plus',
  group: 'Conversations',
  input: z.object({
    text: z.string().min(1).describe('First Markdown message to submit in the new conversation'),
  }),
  output: messageSubmissionSchema,
  handle: async params => ({
    conversation_id: await startConversationFromComposer(params.text),
    accepted: true as const,
  }),
});
