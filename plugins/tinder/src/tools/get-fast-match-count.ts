import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import type { TinderResponse } from './schemas.js';

export const getFastMatchCount = defineTool({
  name: 'get_fast_match_count',
  displayName: 'Get Fast Match Count',
  description:
    'Get the count of people who have already liked you. These are profiles available in the "Likes You" section (Tinder Gold/Platinum feature).',
  summary: 'Get count of people who liked you',
  icon: 'zap',
  group: 'Fast Match',
  input: z.object({}),
  output: z.object({
    count: z.number().describe('Number of people who liked you'),
  }),
  handle: async () => {
    const data = await api<TinderResponse<{ count: number }>>('/v2/fast-match/count');
    return { count: data.data?.count ?? 0 };
  },
});
