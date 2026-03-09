import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';

interface WatchlistItem {
  object_id?: string;
  object_type?: string;
}

interface WatchlistDetail {
  display_name?: string;
  item_count?: number;
}

export const getWatchlist = defineTool({
  name: 'get_watchlist',
  displayName: 'Get Watchlist',
  description:
    'Get a specific watchlist by its ID including display name, item count, and all items with their instrument IDs. Use list_watchlists to find available list IDs.',
  summary: 'Get watchlist details and items',
  icon: 'list',
  group: 'Lists',
  input: z.object({
    list_id: z.string().describe('Watchlist UUID from list_watchlists'),
  }),
  output: z.object({
    display_name: z.string().describe('Watchlist display name'),
    item_count: z.number().describe('Number of items in the watchlist'),
    items: z
      .array(
        z.object({
          object_id: z.string().describe('Instrument UUID or currency pair ID'),
          object_type: z.string().describe('Item type (e.g., instrument, currency_pair)'),
        }),
      )
      .describe('List of watchlist items'),
  }),
  handle: async params => {
    const [detail, allItems] = await Promise.all([
      api<WatchlistDetail>(`/discovery/lists/${params.list_id}/`, {
        query: { owner_type: 'custom' },
      }),
      api<Record<string, WatchlistItem[]>>('/discovery/lists/user_items/'),
    ]);

    const items = allItems[params.list_id] ?? [];
    return {
      display_name: detail.display_name ?? '',
      item_count: detail.item_count ?? 0,
      items: items.map(i => ({
        object_id: i.object_id ?? '',
        object_type: i.object_type ?? '',
      })),
    };
  },
});
