import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import type { TinderResponse } from './schemas.js';

export const getFastMatchPreview = defineTool({
  name: 'get_fast_match_preview',
  displayName: 'Get Fast Match Preview',
  description:
    'Get a preview of the people who liked you. Returns blurred preview images. Full profiles require Tinder Gold or Platinum subscription.',
  summary: 'Preview people who liked you',
  icon: 'eye',
  group: 'Fast Match',
  input: z.object({}),
  output: z.object({
    previews: z
      .array(
        z.object({
          id: z.string().describe('User ID'),
          image_url: z.string().describe('Blurred preview image URL'),
        }),
      )
      .describe('Blurred preview images of people who liked you'),
  }),
  handle: async () => {
    const data =
      await api<
        TinderResponse<{
          data: Array<{ user: { _id?: string; photos?: Array<{ url?: string }> } }>;
        }>
      >('/v2/fast-match/teaser');
    const items = data.data?.data ?? [];
    return {
      previews: items.map(item => ({
        id: item.user?._id ?? '',
        image_url: item.user?.photos?.[0]?.url ?? '',
      })),
    };
  },
});
