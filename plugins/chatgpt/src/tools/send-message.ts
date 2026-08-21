import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { sendCurrentConversationMessage } from '../conversation-messaging.js';
import { messageSubmissionSchema } from './schemas.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    'Submit Markdown text to an existing ChatGPT project conversation and return once the ChatGPT composer accepts the submission. Assistant generation continues independently and is not awaited. The selected ChatGPT tab must already show this exact conversation. The tool refuses to act while the conversation is generating or when the composer contains an unsent draft.',
  summary: 'Send a message in the selected project conversation',
  icon: 'send',
  group: 'Conversations',
  input: z.object({
    conversation_id: z.string().describe('Conversation ID (UUID) currently open in the selected ChatGPT tab'),
    expected_project_id: z.string().describe('Project ID beginning with "g-p-" expected in the selected tab'),
    text: z.string().min(1).describe('Markdown message text to send'),
  }),
  output: messageSubmissionSchema,
  handle: async params => {
    await sendCurrentConversationMessage({
      conversationId: params.conversation_id,
      expectedProjectId: params.expected_project_id,
      text: params.text,
    });
    return { conversation_id: params.conversation_id, accepted: true as const };
  },
});
