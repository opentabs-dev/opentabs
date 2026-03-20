import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../outlook-api.js';
import { MESSAGE_SUMMARY_FIELDS, type RawMessage, mapMessageSummary, messageSummarySchema } from './schemas.js';

export const listMessages = defineTool({
  name: 'list_messages',
  displayName: 'List Messages',
  description:
    'List email messages from a mail folder. Defaults to Inbox. Use folder_id to target other folders (get IDs from list_folders). Results are ordered by most recent first.',
  summary: 'List emails in a folder',
  icon: 'inbox',
  group: 'Messages',
  input: z.object({
    folder_id: z
      .string()
      .optional()
      .describe(
        'Mail folder ID or well-known name (Inbox, Drafts, SentItems, DeletedItems, Archive). Defaults to Inbox.',
      ),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
    skip: z.number().int().min(0).optional().describe('Number of messages to skip for pagination'),
    filter: z
      .string()
      .optional()
      .describe('OData $filter expression (e.g. "isRead eq false", "importance eq \'high\'")'),
  }),
  output: z.object({
    messages: z.array(messageSummarySchema).describe('Email messages'),
    total_count: z.number().optional().describe('Total count if available'),
  }),
  handle: async params => {
    const folder = params.folder_id ?? 'Inbox';
    const endpoint = `/me/mailFolders/${folder}/messages`;
    const data = await api<{ value: RawMessage[]; '@odata.count'?: number }>(endpoint, {
      query: {
        $select: MESSAGE_SUMMARY_FIELDS,
        $orderby: 'receivedDateTime desc',
        $top: params.limit ?? 10,
        $skip: params.skip,
        $filter: params.filter,
        $count: true,
      },
      headers: { ConsistencyLevel: 'eventual' },
    });
    return {
      messages: (data.value ?? []).map(mapMessageSummary),
      total_count: data['@odata.count'],
    };
  },
});
