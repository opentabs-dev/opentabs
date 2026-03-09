import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';

export const superLikeUser = defineTool({
  name: 'super_like_user',
  displayName: 'Super Like User',
  description:
    'Super Like a user (swipe up). Limited availability — check remaining super likes in get_metadata. Returns whether the super like resulted in a match.',
  summary: 'Super Like a user',
  icon: 'star',
  group: 'Discovery',
  input: z.object({
    user_id: z.string().describe('User ID to super like'),
  }),
  output: z.object({
    match: z.boolean().describe('Whether the super like resulted in a match'),
    super_likes_remaining: z.number().describe('Remaining super likes'),
  }),
  handle: async params => {
    const data = await api<{
      status?: number;
      match?: boolean;
      super_likes?: { remaining?: number };
    }>(`/like/${params.user_id}/super`, { method: 'POST' });

    return {
      match: data.match ?? false,
      super_likes_remaining: data.super_likes?.remaining ?? 0,
    };
  },
});
