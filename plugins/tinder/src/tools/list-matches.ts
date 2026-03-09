import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawMatch, type TinderResponse, mapMatch, matchSchema } from './schemas.js';

export const listMatches = defineTool({
  name: 'list_matches',
  displayName: 'List Matches',
  description:
    'List your Tinder matches. Returns matched profiles with message counts and activity dates. Use the page_token from a previous response to paginate.',
  summary: 'List your matches',
  icon: 'users',
  group: 'Matches',
  input: z.object({
    count: z.number().int().min(1).max(100).optional().describe('Number of matches to return (default 20, max 100)'),
    page_token: z.string().optional().describe('Pagination token from a previous response'),
  }),
  output: z.object({
    matches: z.array(matchSchema).describe('List of matches'),
    next_page_token: z.string().describe('Token for next page, empty if no more'),
  }),
  handle: async params => {
    const query: Record<string, string | number | boolean | undefined> = {
      count: params.count ?? 20,
      locale: 'en',
      is_tinder_u: false,
    };
    if (params.page_token) {
      query.page_token = params.page_token;
    }
    const data = await api<TinderResponse<{ matches: RawMatch[]; next_page_token?: string }>>('/v2/matches', { query });
    return {
      matches: (data.data?.matches ?? []).map(mapMatch),
      next_page_token: data.data?.next_page_token ?? '',
    };
  },
});
