import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getRequiredAuthToken } from '../panda-api.js';
import { type RawFavorite, favoriteSchema, mapFavorite } from './schemas.js';

export const getFavorites = defineTool({
  name: 'get_favorites',
  displayName: 'Get Favorites',
  description:
    "Get the authenticated user's saved favorite orders. Favorites can be quickly reordered. Requires the user to be logged in.",
  summary: 'View your saved favorite orders',
  icon: 'heart',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    favorites: z.array(favoriteSchema).describe('List of saved favorites'),
  }),
  handle: async () => {
    const authtoken = getRequiredAuthToken();
    const data = await api<{ faves?: RawFavorite[] }>(`/users/${authtoken}/faves`);
    return { favorites: (data.faves ?? []).map(mapFavorite) };
  },
});
