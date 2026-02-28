import { slackApi } from '../slack-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

const matchSchema = z.object({
  channel: z
    .object({
      id: z.string().describe('Channel ID where the message was found'),
      name: z.string().describe('Channel name'),
    })
    .describe('Channel information'),
  username: z.string().describe('Username of the message author'),
  text: z.string().describe('Message text content'),
  ts: z.string().describe('Message timestamp'),
  permalink: z.string().describe('Permanent link to the message'),
});

interface SearchMatch {
  channel?: { id: string; name: string };
  username: string;
  text: string;
  ts: string;
  permalink: string;
}

interface SearchMessagesPaging {
  count: number;
  total: number;
  page: number;
  pages: number;
}

interface SearchMessagesResponse {
  total: number;
  matches?: SearchMatch[];
  paging?: SearchMessagesPaging;
}

export const searchMessages = defineTool({
  name: 'search_messages',
  displayName: 'Search Messages',
  description: 'Search for messages across Slack channels with optional pagination and sorting',
  icon: 'search',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe('Search query string — supports Slack search modifiers (e.g., "from:@user in:#channel")'),
    count: z.number().int().min(1).optional().describe('Number of results to return per page (default 20)'),
    page: z.number().int().min(1).optional().describe('Page number of results to return (default 1)'),
    sort: z.enum(['score', 'timestamp']).optional().describe('Sort field — relevance or recency (default "score")'),
    sort_dir: z.enum(['asc', 'desc']).optional().describe('Sort direction (default "desc")'),
  }),
  output: z.object({
    messages: z
      .object({
        total: z.number().describe('Total number of matching messages'),
        matches: z.array(matchSchema).describe('Array of matching messages'),
        paging: z
          .object({
            count: z.number().describe('Number of results per page'),
            total: z.number().describe('Total number of matching messages'),
            page: z.number().describe('Current page number'),
            pages: z.number().describe('Total number of pages'),
          })
          .optional()
          .describe('Pagination metadata'),
      })
      .describe('Search results'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      query: params.query,
      count: params.count ?? 20,
    };
    if (params.page !== undefined) {
      body.page = params.page;
    }
    if (params.sort) {
      body.sort = params.sort;
    }
    if (params.sort_dir) {
      body.sort_dir = params.sort_dir;
    }
    const data = await slackApi<{ messages?: SearchMessagesResponse }>('search.messages', body);
    const messages = data.messages ?? { total: 0, matches: [] as SearchMatch[] };
    return {
      messages: {
        total: messages.total,
        matches: (messages.matches ?? []).map(m => ({
          channel: {
            id: m.channel?.id ?? '',
            name: m.channel?.name ?? '',
          },
          username: m.username ?? '',
          text: m.text ?? '',
          ts: m.ts ?? '',
          permalink: m.permalink ?? '',
        })),
        paging: messages.paging
          ? {
              count: messages.paging.count,
              total: messages.paging.total,
              page: messages.paging.page,
              pages: messages.paging.pages,
            }
          : undefined,
      },
    };
  },
});
