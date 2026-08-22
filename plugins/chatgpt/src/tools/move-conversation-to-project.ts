import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import {
  awaitConversationInProject,
  isConversationInProject,
  setConversationProject,
} from '../conversation-messaging.js';

export const moveConversationToProject = defineTool({
  name: 'move_conversation_to_project',
  displayName: 'Move Conversation to Project',
  description:
    'Move an existing eligible ChatGPT conversation into a project. This changes future conversation context; it does not recreate the conversation or retroactively run its first turn with project context. ChatGPT rejects ineligible conversations such as temporary chats or chats tied to a custom GPT. The tool verifies project membership before returning.',
  summary: 'Move a conversation into a project',
  icon: 'folder-input',
  group: 'Projects',
  input: z.object({
    conversation_id: z.string().min(1).describe('Conversation ID (UUID) to move'),
    project_id: z.string().startsWith('g-p-').describe('Destination ChatGPT project ID beginning with "g-p-"'),
  }),
  output: z.object({
    conversation_id: z.string().describe('Conversation ID that is now in the project'),
    project_id: z.string().describe('Destination project ID'),
  }),
  handle: async params => {
    if (!(await isConversationInProject(params.project_id, params.conversation_id))) {
      await setConversationProject(params.conversation_id, params.project_id);
      await awaitConversationInProject(params.project_id, params.conversation_id);
    }

    return {
      conversation_id: params.conversation_id,
      project_id: params.project_id,
    };
  },
});
