import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import type { RawBasket, RawRestaurant } from './schemas.js';

/**
 * Key used to stash the pending basket state across page navigations.
 * The problem: writing to `persist:root` before navigating is unreliable because
 * the SPA's in-memory Redux store flushes back to localStorage during page teardown,
 * overwriting our write. The solution: store the desired state in a separate key,
 * navigate to the bag page, then apply it on the new page before Redux hydrates.
 * See `applyPendingBasket()` which runs at adapter IIFE load time in `index.ts`.
 */
export const PENDING_BASKET_KEY = '__opentabs_pending_basket';

/**
 * Apply a pending basket stashed by `navigate_to_checkout`.
 * Called at adapter IIFE load time on every page load.
 *
 * The adapter runs at `document_idle` — after the SPA's scripts have already
 * hydrated Redux from `persist:root`. Writing to `persist:root` at this point
 * is useless because the SPA's in-memory store will overwrite it on the next flush.
 *
 * To handle this reliably: write the basket into `persist:root`, remove the
 * pending key, then reload the page. The second load has no pending key so
 * the reload doesn't loop, and the SPA hydrates with the correct basket data.
 */
export const applyPendingBasket = (): void => {
  if (typeof localStorage === 'undefined') return;

  const pending = localStorage.getItem(PENDING_BASKET_KEY);
  if (!pending) return;

  // Remove the stash first to prevent reload loops
  localStorage.removeItem(PENDING_BASKET_KEY);

  try {
    const { basket, restaurantExtRef, restaurantName, productCount } = JSON.parse(pending) as {
      basket: RawBasket;
      restaurantExtRef: string;
      restaurantName: string;
      productCount: number;
    };

    const raw = localStorage.getItem('persist:root');
    if (!raw) return;

    const root = JSON.parse(raw) as Record<string, string>;
    const appState = JSON.parse(root.appState ?? '{}') as Record<string, unknown>;

    appState.basket = { ...basket, restaurantExtRef };
    appState.basketItemCount = productCount;
    if (restaurantName) appState.vendorName = restaurantName;

    root.appState = JSON.stringify(appState);
    localStorage.setItem('persist:root', JSON.stringify(root));
  } catch {
    return;
  }

  // Reload the page so the SPA hydrates from the updated persist:root.
  // The pending key is already removed so this won't loop.
  window.location.reload();
};

export const navigateToCheckout = defineTool({
  name: 'navigate_to_checkout',
  displayName: 'Navigate to Checkout',
  description:
    'Sync a basket into the browser session and navigate to the checkout page. The user sees the payment page with their order ready — they only need to select a payment method and place the order. Call this after building a basket with add_product_to_basket.',
  summary: 'Open the checkout page for a basket',
  icon: 'credit-card',
  group: 'Orders',
  input: z.object({
    basket_id: z.string().describe('Basket ID (UUID) to check out'),
    restaurant_name: z.string().optional().describe('Restaurant name for display (auto-detected if omitted)'),
    restaurant_ext_ref: z
      .string()
      .optional()
      .describe('Restaurant external reference number (auto-detected if omitted)'),
  }),
  output: z.object({
    navigated: z.boolean().describe('Whether the checkout page was opened'),
    url: z.string().describe('The checkout page URL'),
  }),
  handle: async params => {
    // Fetch the full basket from the API
    const basket = await api<RawBasket>(`/baskets/${params.basket_id}`);
    if (!basket.id) throw ToolError.notFound('Basket not found');

    const productCount = Array.isArray(basket.products) ? basket.products.length : 0;
    if (productCount === 0) throw ToolError.validation('Basket is empty — add products before checking out.');

    // Resolve restaurant name and extref if not provided
    let restaurantName = params.restaurant_name ?? '';
    let restaurantExtRef = params.restaurant_ext_ref ?? '';

    if (!restaurantName || !restaurantExtRef) {
      try {
        const data = await api<{ restaurants?: RawRestaurant[] }>(
          `/restaurants/${basket.vendorid}?includealiases=true`,
        );
        const restaurant = data.restaurants?.[0];
        if (restaurant) {
          if (!restaurantName) restaurantName = restaurant.name ?? '';
          if (!restaurantExtRef) restaurantExtRef = restaurant.extref ?? '';
        }
      } catch {
        // Non-critical — continue without restaurant metadata
      }
    }

    // Stash the basket in a separate localStorage key that survives page navigation.
    // The SPA's Redux persist flushes in-memory state to `persist:root` during page
    // teardown, which would overwrite a direct write. By using a separate key, we
    // avoid the race. `applyPendingBasket()` applies it on the next page load
    // before Redux hydrates.
    localStorage.setItem(
      PENDING_BASKET_KEY,
      JSON.stringify({ basket, restaurantExtRef, restaurantName, productCount }),
    );

    // Navigate to the bag page. The SPA requires going through /order/my-bag
    // before /order/checkout because the checkout component depends on bag-page
    // initialization. After the bag page loads, the user clicks CHECKOUT to pay.
    window.location.href = 'https://www.pandaexpress.com/order/my-bag';

    return { navigated: true, url: 'https://www.pandaexpress.com/order/my-bag' };
  },
});
