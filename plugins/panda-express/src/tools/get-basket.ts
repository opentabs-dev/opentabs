import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import {
  type RawBasket,
  type RawBasketProduct,
  basketProductSchema,
  basketSchema,
  mapBasket,
  mapBasketProduct,
} from './schemas.js';

export const getBasket = defineTool({
  name: 'get_basket',
  displayName: 'Get Basket',
  description: 'Get the current contents and totals of an order basket including all products, quantities, and prices.',
  summary: 'View basket contents and totals',
  icon: 'shopping-bag',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID from create_basket)'),
  }),
  output: z.object({
    basket: basketSchema.describe('Basket summary'),
    products: z.array(basketProductSchema).describe('Products in the basket'),
  }),
  handle: async params => {
    const data = await api<RawBasket & { products?: RawBasketProduct[] }>(`/baskets/${params.basket_id}`);
    return {
      basket: mapBasket(data),
      products: (data.products ?? []).map(mapBasketProduct),
    };
  },
});
