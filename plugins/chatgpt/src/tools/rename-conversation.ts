import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../chatgpt-api.js';

export const renameConversation = defineTool({
  name: 'rename_conversation',
  displayName: 'Rename Conversation',
  description:
    'Rename a ChatGPT conversation independently of conversation creation. This performs one metadata update and does not wait for automatic title generation; call it after ChatGPT has generated a title when the final name must persist.',
  summary: 'Rename a conversation',
  icon: 'pencil',
  group: 'Conversations',
  input: z.object({
    conversation_id: z.string().describe('Conversation ID (UUID)'),
    title: z.string().describe('New title for the conversation'),
  }),
  output: z.object({ success: z.boolean().describe('Whether the operation succeeded') }),
  handle: async params => {
    await api(`/conversation/${params.conversation_id}`, {
      method: 'PATCH',
      body: { title: params.title },
    });
    return { success: true };
  },
});
