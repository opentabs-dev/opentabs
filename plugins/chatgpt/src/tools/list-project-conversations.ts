import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { listProjectConversationPage } from '../conversation-messaging.js';
import { conversationListItemSchema } from './schemas.js';

export const listProjectConversations = defineTool({
  name: 'list_project_conversations',
  displayName: 'List Project Conversations',
  description:
    'List conversations belonging to one ChatGPT project. Uses the project-scoped cursor API, so it does not scan the account-wide conversation history. Pass the returned cursor to retrieve the next page.',
  summary: 'List conversations in a ChatGPT project',
  icon: 'folder-open',
  group: 'Projects',
  input: z.object({
    project_id: z.string().describe('ChatGPT project ID beginning with "g-p-"'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response; starts at "0"'),
    limit: z.number().int().min(1).max(50).optional().describe('Results per page (default 50, max 50)'),
  }),
  output: z.object({
    conversations: z.array(conversationListItemSchema).describe('Conversations in this project page'),
    cursor: z.string().describe('Cursor for the next page, empty if there are no more results'),
  }),
  handle: params => listProjectConversationPage(params.project_id, params.cursor ?? '0', params.limit ?? 50),
});
