import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { doraApi } from '../robinhood-api.js';
import { type RawNewsFeedItem, mapNewsFeedItem, newsFeedItemSchema } from './schemas.js';

export const getNewsFeed = defineTool({
  name: 'get_news_feed',
  displayName: 'Get News Feed',
  description: 'Get the news and market feed. Optionally filter by instrument ID.',
  summary: 'Get news and market feed',
  icon: 'newspaper',
  group: 'Market Data',
  input: z.object({
    instrument_id: z.string().optional().describe('Instrument UUID to filter news for a specific stock'),
  }),
  output: z.object({
    items: z.array(newsFeedItemSchema).describe('List of news feed items'),
  }),
  handle: async params => {
    const query: Record<string, string | undefined> = {};
    if (params.instrument_id) {
      query.instrument_ids = params.instrument_id;
    }
    const data = await doraApi<{ results: RawNewsFeedItem[] }>('/feed/', { query });
    const items = (data.results ?? []).map(mapNewsFeedItem);
    return { items };
  },
});
