import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawBasket, basketSchema, mapBasket } from './schemas.js';

export const createBasket = defineTool({
  name: 'create_basket',
  displayName: 'Create Basket',
  description:
    'Create a new order basket (cart) at a specific Panda Express restaurant. The basket must be created before adding products. Use "asap" for timewanted to order immediately.',
  summary: 'Start a new order at a restaurant',
  icon: 'shopping-cart',
  group: 'Orders',
  input: z.object({
    restaurant_id: z.number().int().describe('Restaurant ID to order from'),
    time_wanted: z.string().optional().describe('Desired pickup/delivery time, or "asap" (default "asap")'),
  }),
  output: z.object({
    basket: basketSchema.describe('The created basket'),
  }),
  handle: async params => {
    const data = await api<RawBasket>('/baskets/create', {
      method: 'POST',
      body: {
        vendorid: params.restaurant_id,
        timewanted: params.time_wanted ?? 'asap',
      },
    });
    return { basket: mapBasket(data) };
  },
});
