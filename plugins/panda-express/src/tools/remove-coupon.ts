import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawBasket, basketSchema, mapBasket } from './schemas.js';

export const removeCoupon = defineTool({
  name: 'remove_coupon',
  displayName: 'Remove Coupon',
  description: 'Remove a previously applied coupon from the basket.',
  summary: 'Remove a coupon from your order',
  icon: 'ticket-x',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID)'),
  }),
  output: z.object({
    basket: basketSchema.describe('Updated basket after coupon removal'),
  }),
  handle: async params => {
    const data = await api<RawBasket>(`/baskets/${params.basket_id}/coupon`, {
      method: 'DELETE',
    });
    return { basket: mapBasket(data) };
  },
});
