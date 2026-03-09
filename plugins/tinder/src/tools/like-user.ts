import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiDirect } from '../tinder-api.js';

export const likeUser = defineTool({
  name: 'like_user',
  displayName: 'Like User',
  description:
    'Like (swipe right on) a user. Returns whether the like resulted in a match. Pass the content_hash and s_number from get_recommendations for best results.',
  summary: 'Like a user',
  icon: 'heart',
  group: 'Discovery',
  input: z.object({
    user_id: z.string().describe('User ID to like'),
    content_hash: z.string().describe('Content hash from get_recommendations').optional(),
    s_number: z.number().describe('S number from get_recommendations').optional(),
  }),
  output: z.object({
    match: z.boolean().describe('Whether this like resulted in a match'),
    likes_remaining: z.number().describe('Remaining likes for the period'),
  }),
  handle: async params => {
    const data = await apiDirect<{ match?: boolean; likes_remaining?: number }>(`/like/${params.user_id}`, {
      query: {
        content_hash: params.content_hash,
        s_number: params.s_number,
      },
    });

    return {
      match: data.match ?? false,
      likes_remaining: data.likes_remaining ?? 0,
    };
  },
});
