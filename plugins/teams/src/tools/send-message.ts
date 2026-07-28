import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { MARKDOWN_FORMATTING_HELP, markdownToTeamsHtml } from '../markdown-html.js';
import { chatApi } from '../teams-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description:
    'Send a message to a Teams chat conversation. Use the conversation ID from list_conversations or create_chat. ' +
    MARKDOWN_FORMATTING_HELP,
  summary: 'Send a message to a chat',
  icon: 'send',
  group: 'Messages',
  input: z.object({
    conversation_id: z.string().min(1).describe('Conversation/thread ID to send the message to'),
    text: z.string().min(1).describe('Message text in Markdown'),
  }),
  output: z.object({
    message_id: z.string().describe('Server-assigned message ID (arrival timestamp)'),
    client_message_id: z.string().describe('Client-assigned message ID'),
  }),
  handle: async params => {
    const clientMsgId = Date.now().toString();
    const data = await chatApi<{ OriginalArrivalTime?: number }>(
      `/v1/users/ME/conversations/${encodeURIComponent(params.conversation_id)}/messages`,
      {
        method: 'POST',
        body: {
          content: markdownToTeamsHtml(params.text),
          messagetype: 'RichText/Html',
          contenttype: 'text',
          clientmessageid: clientMsgId,
        },
      },
    );

    return {
      message_id: String(data.OriginalArrivalTime ?? ''),
      client_message_id: clientMsgId,
    };
  },
});
