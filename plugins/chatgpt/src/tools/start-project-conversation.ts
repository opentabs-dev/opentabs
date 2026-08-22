import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { startProjectConversation as startProjectConversationFromComposer } from '../conversation-messaging.js';
import { messageSubmissionSchema } from './schemas.js';

export const startProjectConversation = defineTool({
  name: 'start_project_conversation',
  displayName: 'Start Project Conversation',
  description:
    "Start a ChatGPT conversation inside a project by submitting its first Markdown message through the project composer. The selected ChatGPT tab must already show that project's /project new-chat page so project instructions and files apply to the first turn. The tool returns once ChatGPT accepts the message and exposes the conversation ID; assistant generation and automatic title generation continue independently.",
  summary: 'Start a conversation in a project',
  icon: 'folder-plus',
  group: 'Projects',
  input: z.object({
    project_id: z.string().startsWith('g-p-').describe('ChatGPT project ID beginning with "g-p-"'),
    text: z.string().min(1).describe('First Markdown message to submit in the project conversation'),
  }),
  output: messageSubmissionSchema.extend({
    project_id: z.string().describe('ChatGPT project ID that supplied the new conversation context'),
  }),
  handle: async params => ({
    project_id: params.project_id,
    conversation_id: await startProjectConversationFromComposer(params.project_id, params.text),
    accepted: true as const,
  }),
});
