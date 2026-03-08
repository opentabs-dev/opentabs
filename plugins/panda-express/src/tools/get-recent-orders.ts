import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getRequiredAuthToken } from '../panda-api.js';
import { type RawOrder, mapOrder, orderSchema } from './schemas.js';

export const getRecentOrders = defineTool({
  name: 'get_recent_orders',
  displayName: 'Get Recent Orders',
  description:
    "Get the authenticated user's recent order history. Returns orders with restaurant info, totals, and status. Requires the user to be logged in.",
  summary: 'View your recent Panda Express orders',
  icon: 'history',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    orders: z.array(orderSchema).describe('List of recent orders'),
  }),
  handle: async () => {
    const authtoken = getRequiredAuthToken();
    const data = await api<{ orders?: RawOrder[] }>(`/users/${authtoken}/recentorders`);
    return { orders: (data.orders ?? []).map(mapOrder) };
  },
});
