import { z } from 'zod';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { graphqlQuery } from '../x-api.js';
import { userSchema, mapUser, extractUsersFromTimeline, extractCursor } from './schemas.js';

export const getRetweeters = defineTool({
  name: 'get_retweeters',
  displayName: 'Get Retweeters',
  description:
    'Get the users who retweeted a tweet, by tweet ID. Returns a paginated list of users. ' +
    'Useful for engagement-fanout discovery — finding accounts that amplified a given post.',
  summary: 'List users who retweeted a tweet',
  icon: 'repeat',
  group: 'Engagement',
  input: z.object({
    tweet_id: z.string().min(1).describe('Tweet ID to get retweeters for'),
    count: z.int().min(1).max(50).optional().describe('Number of users (default 20, max 50)'),
    cursor: z.string().optional().describe('Pagination cursor'),
  }),
  output: z.object({
    users: z.array(userSchema),
    cursor: z.string().optional().describe('Cursor for next page'),
  }),
  handle: async params => {
    const data = await graphqlQuery<Record<string, unknown>>('Retweeters', {
      tweetId: params.tweet_id,
      count: params.count ?? 20,
      includePromotedContent: false,
      ...(params.cursor ? { cursor: params.cursor } : {}),
    });

    const timelinePath = ['data', 'retweeters_timeline', 'timeline'];
    const rawUsers = extractUsersFromTimeline(data, timelinePath);
    const nextCursor = extractCursor(data, timelinePath);

    return {
      users: rawUsers.map(mapUser),
      cursor: nextCursor,
    };
  },
});
