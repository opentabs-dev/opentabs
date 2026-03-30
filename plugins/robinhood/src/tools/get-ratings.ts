import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import {
  type RawRatingSummary,
  type RawRating,
  ratingSummarySchema,
  ratingSchema,
  mapRatingSummary,
  mapRating,
} from './schemas.js';

interface RatingsResponse {
  results: { summary: RawRatingSummary; ratings: RawRating[] }[];
}

export const getRatings = defineTool({
  name: 'get_ratings',
  displayName: 'Get Ratings',
  description:
    'Get analyst ratings for a stock by instrument UUID. Returns a summary of buy/hold/sell counts and individual analyst ratings with commentary. Use search_instruments to find the instrument ID.',
  summary: 'Get analyst ratings for a stock',
  icon: 'star',
  group: 'Market Data',
  input: z.object({
    instrument_id: z.string().describe('Instrument UUID — use search_instruments to find it'),
  }),
  output: z.object({
    summary: ratingSummarySchema.describe('Aggregate buy/hold/sell rating counts'),
    ratings: z.array(ratingSchema).describe('Individual analyst ratings'),
  }),
  handle: async params => {
    const data = await api<RatingsResponse>('/midlands/ratings/', { query: { ids: params.instrument_id } });
    const first = data.results?.[0];
    if (!first) {
      return {
        summary: { num_buy_ratings: 0, num_hold_ratings: 0, num_sell_ratings: 0 },
        ratings: [],
      };
    }
    return {
      summary: mapRatingSummary(first.summary ?? {}),
      ratings: (first.ratings ?? []).map(mapRating),
    };
  },
});
