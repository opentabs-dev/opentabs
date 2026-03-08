import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawRestaurant, mapRestaurant, restaurantSchema } from './schemas.js';

export const findRestaurants = defineTool({
  name: 'find_restaurants',
  displayName: 'Find Restaurants',
  description:
    'Search for nearby Panda Express restaurants by geographic coordinates. Returns restaurants sorted by distance with availability, delivery, and pickup status.',
  summary: 'Find nearby Panda Express locations',
  icon: 'map-pin',
  group: 'Restaurants',
  input: z.object({
    latitude: z.number().describe('Latitude coordinate of the search center'),
    longitude: z.number().describe('Longitude coordinate of the search center'),
    radius: z.number().optional().describe('Search radius in miles (default 10)'),
    limit: z.number().int().optional().describe('Maximum number of results (default 10)'),
  }),
  output: z.object({
    restaurants: z.array(restaurantSchema).describe('List of nearby restaurants'),
  }),
  handle: async params => {
    const data = await api<{ restaurants?: RawRestaurant[] }>('/restaurants/near', {
      query: {
        lat: params.latitude,
        long: params.longitude,
        radius: params.radius ?? 10,
        limit: params.limit ?? 10,
      },
    });
    return { restaurants: (data.restaurants ?? []).map(mapRestaurant) };
  },
});
