import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawWatchlist, mapWatchlist, watchlistSchema } from './schemas.js';

export const listWatchlists = defineTool({
  name: 'list_watchlists',
  displayName: 'List Watchlists',
  description:
    'List all watchlists (discovery lists) including default and custom lists with their display names, item counts, and emoji icons.',
  summary: 'List all watchlists',
  icon: 'list',
  group: 'Lists',
  input: z.object({}),
  output: z.object({
    lists: z.array(watchlistSchema).describe('List of watchlists'),
  }),
  handle: async () => {
    const data = await api<{ results: RawWatchlist[] }>('/discovery/lists/default/');
    const lists = (data.results ?? []).map(mapWatchlist);
    return { lists };
  },
});
