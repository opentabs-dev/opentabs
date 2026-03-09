import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';

export const deleteWatchlist = defineTool({
  name: 'delete_watchlist',
  displayName: 'Delete Watchlist',
  description: 'Permanently delete a custom watchlist by its ID. This action cannot be undone.',
  summary: 'Delete a custom watchlist',
  icon: 'trash-2',
  group: 'Lists',
  input: z.object({
    list_id: z.string().describe('Watchlist UUID to delete (from list_watchlists)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
  handle: async params => {
    await api(`/discovery/lists/${params.list_id}/`, {
      method: 'DELETE',
      query: { owner_type: 'custom' },
    });
    return { success: true };
  },
});
