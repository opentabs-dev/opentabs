import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { resolveProjectConversationByTitle, sendCurrentConversationMessage } from '../conversation-messaging.js';
import { messageSubmissionSchema } from './schemas.js';

export const sendProjectSessionMessage = defineTool({
  name: 'send_project_session_message',
  displayName: 'Send Project Session Message',
  description:
    'Resolve one conversation by exact title within a ChatGPT project, submit Markdown text, and return once the ChatGPT composer accepts the submission. Assistant generation continues independently and is not awaited. Resolution exhausts project-scoped pagination and fails on zero or multiple exact title matches. The selected ChatGPT tab must already show the resolved conversation, contain no unsent draft, and not be generating.',
  summary: 'Send a message to a named project session',
  icon: 'messages-square',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('ChatGPT project ID beginning with "g-p-"'),
    session_name: z.string().min(1).describe('Exact conversation title within the project'),
    text: z.string().min(1).describe('Markdown message text to send'),
  }),
  output: messageSubmissionSchema.extend({
    project_id: z.string().describe('ChatGPT project ID containing the resolved conversation'),
    session_name: z.string().describe('Exact conversation title that was resolved'),
  }),
  handle: async params => {
    const conversation = await resolveProjectConversationByTitle(params.project_id, params.session_name);
    await sendCurrentConversationMessage({
      conversationId: conversation.id,
      expectedProjectId: params.project_id,
      text: params.text,
    });

    return {
      project_id: params.project_id,
      conversation_id: conversation.id,
      session_name: conversation.title,
      accepted: true as const,
    };
  },
});
