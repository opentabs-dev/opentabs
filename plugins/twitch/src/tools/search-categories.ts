import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gql } from '../twitch-api.js';
import { gameSchema, mapGame } from './schemas.js';
import type { RawGame } from './schemas.js';

export const searchCategories = defineTool({
  name: 'search_categories',
  displayName: 'Search Categories',
  description:
    'Search for games and categories on Twitch by keyword. Returns matching games with viewer counts and box art.',
  summary: 'Search for games and categories',
  icon: 'search',
  group: 'Search',
  input: z.object({
    query: z.string().describe('Search query text'),
  }),
  output: z.object({ categories: z.array(gameSchema) }),
  handle: async params => {
    const data = await gql<{
      searchFor: { games: { items: RawGame[] } };
    }>(`{
      searchFor(userQuery: "${params.query.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", platform: "web", options: { targets: [{ index: GAME }] }) {
        games {
          items { id name displayName viewersCount broadcastersCount boxArtURL }
        }
      }
    }`);
    return {
      categories: (data.searchFor?.games?.items ?? []).map(mapGame),
    };
  },
});
