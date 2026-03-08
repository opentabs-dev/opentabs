import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawRestaurant, mapRestaurant, restaurantSchema } from './schemas.js';

export const getRestaurant = defineTool({
  name: 'get_restaurant',
  displayName: 'Get Restaurant',
  description:
    'Get detailed information about a specific Panda Express restaurant by its URL slug or external reference number.',
  summary: 'Get restaurant details by slug or ref',
  icon: 'store',
  group: 'Restaurants',
  input: z.object({
    slug: z.string().optional().describe('Restaurant URL slug (e.g., "fillmore-geary-px")'),
    ext_ref: z.string().optional().describe('External reference number (e.g., "4226")'),
  }),
  output: z.object({
    restaurant: restaurantSchema.describe('Restaurant details'),
  }),
  handle: async params => {
    if (params.slug) {
      const data = await api<RawRestaurant>(`/restaurants/byslug/${params.slug}`);
      return { restaurant: mapRestaurant(data) };
    }
    if (params.ext_ref) {
      const data = await api<{ restaurants?: RawRestaurant[] }>(`/restaurants/byref/${params.ext_ref}`);
      const restaurant = data.restaurants?.[0];
      if (!restaurant) throw ToolError.notFound(`No restaurant found with ext_ref "${params.ext_ref}"`);
      return { restaurant: mapRestaurant(restaurant) };
    }
    throw ToolError.validation('Provide either slug or ext_ref');
  },
});
