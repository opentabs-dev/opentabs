import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawBasket, basketSchema, mapBasket } from './schemas.js';

export const updateProductQuantity = defineTool({
  name: 'update_product_quantity',
  displayName: 'Update Product Quantity',
  description:
    'Change the quantity of a product already in the basket. Use the basket product instance ID (from get_basket products list), not the menu product ID. Set quantity to 0 to remove the item.',
  summary: 'Change quantity of an item in your order',
  icon: 'hash',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID)'),
    basket_product_id: z.number().describe('Basket product instance ID (from get_basket products list)'),
    quantity: z.number().int().min(0).describe('New quantity (0 to remove the item)'),
  }),
  output: z.object({
    basket: basketSchema.describe('Updated basket'),
  }),
  handle: async params => {
    if (params.quantity === 0) {
      const data = await api<RawBasket>(`/baskets/${params.basket_id}/products/${params.basket_product_id}`, {
        method: 'DELETE',
      });
      return { basket: mapBasket(data) };
    }
    const data = await api<RawBasket>(`/baskets/${params.basket_id}/products/${params.basket_product_id}`, {
      method: 'PUT',
      body: { quantity: params.quantity },
    });
    return { basket: mapBasket(data) };
  },
});
