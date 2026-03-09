import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import type { RHPaginated } from './schemas.js';
import { type RawOrder, mapOrder, orderSchema } from './schemas.js';

export const listOrders = defineTool({
  name: 'list_orders',
  displayName: 'List Orders',
  description:
    'List recent stock orders. Returns order history including filled, cancelled, and pending orders. Does not place or modify orders.',
  summary: 'List recent stock orders',
  icon: 'receipt',
  group: 'Orders',
  input: z.object({
    updated_at_gte: z.string().optional().describe('Only return orders updated after this ISO date (e.g., 2025-01-01)'),
  }),
  output: z.object({
    orders: z.array(orderSchema).describe('List of stock orders'),
  }),
  handle: async params => {
    const query: Record<string, string | undefined> = {};
    if (params.updated_at_gte) {
      query['updated_at[gte]'] = params.updated_at_gte;
    }
    const data = await api<RHPaginated<RawOrder>>('/orders/', { query });
    const orders = (data.results ?? []).map(mapOrder);
    return { orders };
  },
});
