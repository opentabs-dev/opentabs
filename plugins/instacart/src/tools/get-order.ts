import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gqlQuery } from '../instacart-api.js';
import { type RawOrder, mapOrder, orderSchema } from './schemas.js';

export const getOrder = defineTool({
  name: 'get_order',
  displayName: 'Get Order',
  description:
    'Get details of a specific order by its delivery ID. Returns status, retailer name, total, and item count.',
  summary: 'Get order details',
  icon: 'receipt',
  group: 'Orders',
  input: z.object({
    order_id: z.string().describe('Order delivery ID (from list_orders)'),
  }),
  output: z.object({ order: orderSchema }),
  handle: async params => {
    const data = await gqlQuery<{ orderDelivery: RawOrder }>('OrderDelivery', {
      order_delivery_id: params.order_id,
    });
    return { order: mapOrder(data.orderDelivery ?? {}) };
  },
});
