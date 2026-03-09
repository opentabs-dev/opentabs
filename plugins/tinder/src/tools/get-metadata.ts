import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import type { TinderResponse } from './schemas.js';

interface MetaData {
  super_like?: { remaining?: number };
  boost?: { remaining?: number };
  fast_match?: { count?: number };
}

export const getMetadata = defineTool({
  name: 'get_metadata',
  displayName: 'Get Metadata',
  description:
    'Get account metadata including remaining super likes, boost info, and subscription status. Useful for checking available actions before swiping.',
  summary: 'Get account metadata',
  icon: 'info',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    super_likes_remaining: z.number().describe('Remaining super likes'),
    boost_remaining: z.number().describe('Remaining boosts'),
    likes_count: z.number().describe('Fast match count — people who liked you'),
  }),
  handle: async () => {
    const data = await api<TinderResponse<MetaData>>('/v2/meta', {
      method: 'POST',
      body: {},
    });
    return {
      super_likes_remaining: data.data?.super_like?.remaining ?? 0,
      boost_remaining: data.data?.boost?.remaining ?? 0,
      likes_count: data.data?.fast_match?.count ?? 0,
    };
  },
});
