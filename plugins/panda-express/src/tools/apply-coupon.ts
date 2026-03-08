import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawBasket, basketSchema, mapBasket } from './schemas.js';

export const applyCoupon = defineTool({
  name: 'apply_coupon',
  displayName: 'Apply Coupon',
  description: 'Apply a coupon or promo code to an existing basket. Returns the updated basket with discount applied.',
  summary: 'Apply a coupon code to your order',
  icon: 'ticket',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID)'),
    coupon_code: z.string().describe('Coupon or promo code to apply'),
  }),
  output: z.object({
    basket: basketSchema.describe('Updated basket with coupon applied'),
  }),
  handle: async params => {
    const data = await api<RawBasket>(`/baskets/${params.basket_id}/coupon`, {
      method: 'PUT',
      body: { couponcode: params.coupon_code },
    });
    return { basket: mapBasket(data) };
  },
});
