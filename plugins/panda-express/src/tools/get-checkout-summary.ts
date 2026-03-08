import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';

const checkoutSummarySchema = z.object({
  basket_id: z.string().describe('Basket ID'),
  subtotal: z.number().describe('Subtotal before tax'),
  tax: z.number().describe('Tax amount'),
  total: z.number().describe('Total amount including tax and fees'),
  ready_time: z.string().describe('Estimated ready time'),
});

interface RawValidation {
  basketid?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  readytime?: string;
}

export const getCheckoutSummary = defineTool({
  name: 'get_checkout_summary',
  displayName: 'Get Checkout Summary',
  description:
    'Validate and get the checkout summary for a basket. Returns the total, tax, and estimated ready time. Call this before submitting an order to review the final totals.',
  summary: 'Review order totals before checkout',
  icon: 'receipt',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID)'),
  }),
  output: z.object({
    summary: checkoutSummarySchema.describe('Checkout summary with totals'),
  }),
  handle: async params => {
    const data = await api<RawValidation>(`/baskets/${params.basket_id}/validate`, {
      method: 'POST',
      body: {},
    });
    return {
      summary: {
        basket_id: data.basketid ?? params.basket_id,
        subtotal: data.subtotal ?? 0,
        tax: data.tax ?? 0,
        total: data.total ?? 0,
        ready_time: data.readytime ?? '',
      },
    };
  },
});
