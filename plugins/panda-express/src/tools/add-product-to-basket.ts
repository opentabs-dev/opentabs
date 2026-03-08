import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import { type RawBasket, basketSchema, mapBasket } from './schemas.js';

export const addProductToBasket = defineTool({
  name: 'add_product_to_basket',
  displayName: 'Add Product to Basket',
  description:
    'Add a menu product to an existing basket. Most products require modifier selections — call get_product_modifiers first to get available options, then pass the selected option IDs. For simple products (bottled drinks), only the size option is needed.',
  summary: 'Add a menu item to your order',
  icon: 'plus-circle',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID)'),
    product_id: z.number().int().describe('Product ID from get_restaurant_menu'),
    quantity: z.number().int().optional().describe('Quantity to add (default 1)'),
    options: z
      .array(z.number())
      .optional()
      .describe(
        'Array of modifier option IDs from get_product_modifiers. For combos, include one option from each mandatory group (e.g., side choice, entree choice, drink choice).',
      ),
  }),
  output: z.object({
    basket: basketSchema.describe('Updated basket after adding the product'),
  }),
  handle: async params => {
    const body: Record<string, unknown> = {
      productid: params.product_id,
      quantity: params.quantity ?? 1,
    };
    if (params.options && params.options.length > 0) {
      body.options = params.options.join(',');
    }
    const data = await api<RawBasket>(`/baskets/${params.basket_id}/products`, {
      method: 'POST',
      body,
    });
    return { basket: mapBasket(data) };
  },
});
