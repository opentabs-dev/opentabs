import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';

export const cancelOrder = defineTool({
  name: 'cancel_order',
  displayName: 'Cancel Order',
  description:
    'Cancel a previously submitted order. Only works for orders that have not yet been prepared. The order ID can be obtained from get_recent_orders.',
  summary: 'Cancel a pending order',
  icon: 'x-circle',
  group: 'Orders',
  input: z.object({
    order_id: z.string().describe('Order ID to cancel (from get_recent_orders)'),
  }),
  output: z.object({
    cancelled: z.boolean().describe('Whether the order was successfully cancelled'),
  }),
  handle: async params => {
    await api<Record<string, unknown>>(`/orders/${params.order_id}/cancel`, {
      method: 'POST',
      body: {},
    });
    return { cancelled: true };
  },
});
