import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './panda-api.js';
import { addProductToBasket } from './tools/add-product-to-basket.js';
import { applyCoupon } from './tools/apply-coupon.js';
import { cancelOrder } from './tools/cancel-order.js';
import { createBasket } from './tools/create-basket.js';
import { findRestaurants } from './tools/find-restaurants.js';
import { getBasket } from './tools/get-basket.js';
import { getBillingAccounts } from './tools/get-billing-accounts.js';
import { getCheckoutSummary } from './tools/get-checkout-summary.js';
import { getFavorites } from './tools/get-favorites.js';
import { getLoyaltyRewards } from './tools/get-loyalty-rewards.js';
import { getProductModifiers } from './tools/get-product-modifiers.js';
import { getRecentOrders } from './tools/get-recent-orders.js';
import { getRestaurantMenu } from './tools/get-restaurant-menu.js';
import { getRestaurant } from './tools/get-restaurant.js';
import { getUserProfile } from './tools/get-user-profile.js';
import { applyPendingBasket, navigateToCheckout } from './tools/navigate-to-checkout.js';
import { removeCoupon } from './tools/remove-coupon.js';
import { updateProductQuantity } from './tools/update-product-quantity.js';

// Apply any pending basket stashed by navigate_to_checkout before the SPA hydrates.
// This runs immediately when the adapter IIFE is injected — before isReady() and
// before Redux reads persist:root — to win the race against the SPA's own hydration.
applyPendingBasket();

class PandaExpressPlugin extends OpenTabsPlugin {
  readonly name = 'panda-express';
  readonly description =
    'OpenTabs plugin for Panda Express — search restaurants, browse menus, build orders, checkout, manage loyalty rewards, and view order history.';
  override readonly displayName = 'Panda Express';
  readonly urlPatterns = ['*://*.pandaexpress.com/*'];
  override readonly homepage = 'https://www.pandaexpress.com';
  readonly tools: ToolDefinition[] = [
    findRestaurants,
    getRestaurant,
    getRestaurantMenu,
    getProductModifiers,
    createBasket,
    getBasket,
    addProductToBasket,
    updateProductQuantity,
    applyCoupon,
    removeCoupon,
    getCheckoutSummary,
    navigateToCheckout,
    cancelOrder,
    getUserProfile,
    getRecentOrders,
    getFavorites,
    getBillingAccounts,
    getLoyaltyRewards,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new PandaExpressPlugin();
