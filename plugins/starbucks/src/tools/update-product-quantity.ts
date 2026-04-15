import { ToolError, defineTool, getPageGlobal } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

// CHANGE_QUANTITY dispatches { delta, itemId } to increment/decrement quantity.
// Setting quantity to 0 removes the item from the cart.

type ReduxDispatch = (action: { type: string; payload: unknown }) => void;

interface StarbucksStore {
  dispatch?: ReduxDispatch;
  getState?: () => {
    ordering?: {
      cart?: { current?: Record<string, { quantity?: number }> };
    };
  };
}

export const updateProductQuantity = defineTool({
  name: 'update_product_quantity',
  displayName: 'Update Product Quantity',
  description:
    'Change the quantity of a product already in the cart. Set quantity to 0 to remove it. Get the item_key from get_cart.',
  summary: 'Change cart item quantity or remove it',
  icon: 'edit',
  group: 'Cart',
  input: z.object({
    item_key: z.string().describe('Cart item key from get_cart (e.g., "34833/iced:Grande")'),
    quantity: z.number().int().min(0).describe('New quantity (0 to remove the item)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
    new_quantity: z.number().describe('The resulting quantity'),
  }),
  handle: async params => {
    const store = getPageGlobal('store') as StarbucksStore | undefined;
    if (!store?.dispatch || !store?.getState) throw ToolError.internal('Redux store not available');

    const state = store.getState();
    const cart = state.ordering?.cart?.current ?? {};
    const currentItem = cart[params.item_key];

    if (!currentItem) throw ToolError.notFound(`Item "${params.item_key}" not found in cart`);

    const currentQty = currentItem.quantity ?? 1;
    const delta = params.quantity - currentQty;

    if (delta === 0) return { success: true, new_quantity: currentQty };

    // Dispatch CHANGE_QUANTITY with the delta
    store.dispatch({
      type: 'CHANGE_QUANTITY',
      payload: { delta, itemId: params.item_key },
    });

    return { success: true, new_quantity: params.quantity };
  },
});
