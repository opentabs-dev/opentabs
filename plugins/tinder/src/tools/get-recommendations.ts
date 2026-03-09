import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';
import { type RawRecResult, type TinderResponse, mapRecUser, recUserSchema } from './schemas.js';

export const getRecommendations = defineTool({
  name: 'get_recommendations',
  displayName: 'Get Recommendations',
  description:
    'Get recommended profiles for swiping. Returns user profiles with photos, bio, distance. Use the returned content_hash and s_number when calling like_user or pass_user. Returns up to ~10 profiles per batch.',
  summary: 'Get profiles to swipe on',
  icon: 'compass',
  group: 'Discovery',
  input: z.object({}),
  output: z.object({
    recommendations: z.array(recUserSchema).describe('Recommended user profiles'),
  }),
  handle: async () => {
    const data = await api<TinderResponse<{ results: RawRecResult[] }>>('/v2/recs/core', {
      query: { locale: 'en' },
    });

    const results = data.data?.results;
    if (!results) return { recommendations: [] };

    return { recommendations: results.map(mapRecUser) };
  },
});
