import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawWatchlist, mapWatchlist, watchlistSchema } from './schemas.js';

export const createWatchlist = defineTool({
  name: 'create_watchlist',
  displayName: 'Create Watchlist',
  description: 'Create a new custom watchlist with the specified display name.',
  summary: 'Create a new custom watchlist',
  icon: 'list-plus',
  group: 'Lists',
  input: z.object({
    name: z.string().describe('Display name for the new list'),
  }),
  output: z.object({
    list: watchlistSchema.describe('The newly created watchlist'),
  }),
  handle: async params => {
    const data = await api<RawWatchlist>('/discovery/lists/', {
      method: 'POST',
      body: { display_name: params.name, owner_type: 'custom' },
    });
    return { list: mapWatchlist(data) };
  },
});
