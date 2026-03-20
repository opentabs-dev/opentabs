import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { MESSAGE_SUMMARY_FIELDS, type RawMessage, mapMessageSummary, messageSummarySchema } from './schemas.js';

export const searchMessages = defineTool({
  name: 'search_messages',
  displayName: 'Search Messages',
  description:
    'Search emails using a keyword query (KQL). Searches subject, body, and sender. Examples: "budget report", "from:jane@example.com", "subject:quarterly review", "hasAttachments:true".',
  summary: 'Search emails by keyword',
  icon: 'search',
  group: 'Messages',
  input: z.object({
    query: z.string().describe('Search query (KQL syntax)'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
  }),
  output: z.object({
    messages: z.array(messageSummarySchema).describe('Matching email messages'),
  }),
  handle: async params => {
    const data = await api<{ value: RawMessage[] }>('/me/messages', {
      query: {
        $search: `"${params.query}"`,
        $select: MESSAGE_SUMMARY_FIELDS,
        $top: params.limit ?? 10,
      },
    });
    return { messages: (data.value ?? []).map(mapMessageSummary) };
  },
});
