# opentabs-plugin-panda-express

OpenTabs plugin for Panda Express — search restaurants, browse menus, build orders, manage loyalty rewards, and view order history.

## Tools (18)

### Restaurants

| Tool | Description |
|------|-------------|
| `find_restaurants` | Search for nearby Panda Express locations by coordinates |
| `get_restaurant` | Get restaurant details by slug or external reference number |
| `get_restaurant_menu` | Get the full menu for a restaurant (categories + products) |
| `get_product_modifiers` | Get customization options for a menu item (sides, entrees, drinks, sizes) |

### Orders

| Tool | Description |
|------|-------------|
| `create_basket` | Start a new order at a restaurant |
| `get_basket` | View basket contents, products, and totals |
| `add_product_to_basket` | Add a menu item with modifier selections |
| `update_product_quantity` | Change quantity of an item (set to 0 to remove) |
| `apply_coupon` | Apply a coupon code to the basket |
| `remove_coupon` | Remove a coupon from the basket |
| `get_checkout_summary` | Validate basket and review totals before checkout |
| `navigate_to_checkout` | Sync basket to browser and open the bag/checkout page |
| `cancel_order` | Cancel a previously submitted order |

### Account

| Tool | Description |
|------|-------------|
| `get_user_profile` | View name, email, and loyalty membership status |
| `get_recent_orders` | View past order history |
| `get_favorites` | View saved favorite orders |
| `get_billing_accounts` | View saved payment methods |

### Loyalty

| Tool | Description |
|------|-------------|
| `get_loyalty_rewards` | View available rewards and current points balance |

## Ordering Flow

The AI handles everything except payment. The user's only action is selecting a payment method and tapping "Place Order".

```
find_restaurants → get_restaurant_menu → get_product_modifiers
                                              ↓
                           create_basket → add_product_to_basket → get_checkout_summary
                                              ↓
                                     navigate_to_checkout
                                              ↓
                                   (user selects payment & places order)
```

### Step by step

1. **Find a restaurant** — use `find_restaurants` with lat/lng coordinates
2. **Browse the menu** — use `get_restaurant_menu` with the restaurant ID
3. **Check modifiers** — use `get_product_modifiers` for any product. Most items (bowls, plates, combos) require modifier selections (side choice, entree choice, drink choice). Simple items like bottled drinks only need a size option.
4. **Create a basket** — use `create_basket` with the restaurant ID
5. **Add items** — use `add_product_to_basket` with the product ID and selected option IDs from step 3
6. **Review totals** — use `get_checkout_summary` to validate the basket and see subtotal, tax, and estimated ready time
7. **Navigate to checkout** — use `navigate_to_checkout` to sync the basket into the browser session and open the bag page. The user then clicks CHECKOUT on the bag page to reach the payment screen.

### How `navigate_to_checkout` works

The Panda Express website is an Ionic/Angular SPA that stores the active basket in a Redux persist store (`localStorage persist:root`). The `navigate_to_checkout` tool:

1. Fetches the full basket from the Olo API
2. Resolves the restaurant name and external reference number
3. Writes the basket into the app's Redux persist store (same format the SPA uses)
4. Navigates to `/order/my-bag` — the bag page where the order is displayed

From the bag page, the user clicks CHECKOUT to reach the payment screen. Direct navigation to `/order/checkout` does not work — the SPA's checkout component requires initialization from the bag page.

**Important:** The Panda Express tab must be focused (visible in the foreground) for the SPA to fully render after navigation. Chrome throttles background tabs, which prevents the Ionic framework from hydrating.

### Basket visibility

Baskets created via `create_basket` are new server-side baskets. They become visible on the website through `navigate_to_checkout`, which syncs the basket into the browser's Redux state. Without calling `navigate_to_checkout`, the user would need to manually refresh the page.

Alternatively, to modify the user's existing bag (the one they already see on the website), read the basket ID from Redux state (`appState.basket.id`) and pass it to `get_basket`, `add_product_to_basket`, etc. Changes via the API appear after refreshing the bag page.

### Modifiers are required for most products

Nearly every menu item requires modifier selections:

- **Combos** (Bowl, Plate, Bigger Plate) — choose a side and entrees
- **Panda Cub Meals** — choose side, entree, and drink
- **A La Carte items** — choose a size (Small, Medium, Large)
- **Drinks** — choose a size or container type
- **Appetizers** — choose quantity size (e.g., Small 1pc, Large 6pcs)

Always call `get_product_modifiers` before `add_product_to_basket`. Pass the selected option IDs as the `options` array. If mandatory modifiers are missing, the API returns a validation error.

## Limitations

### No payment submission

The plugin cannot submit payment. Payment requires credit card tokenization through a PCI-compliant proxy (Braintree/Cardinal). The supported payment methods — Credit Card, Gift Card, Apple Pay, PayPal, Venmo — all require browser-side payment flows.

The `navigate_to_checkout` tool bridges this gap: the AI builds the entire order via API, then hands off to the user at the payment screen.

### No delivery address management

Setting delivery addresses requires endpoints that are not proxied through the same origin. Orders default to pickup mode.

### SPA navigation constraints

- The checkout page (`/order/checkout`) cannot be loaded directly — it must be reached via the bag page (`/order/my-bag`) through the SPA's internal router.
- The Panda Express tab must be in the foreground for the SPA to render after navigation. Chrome throttles background tabs.

### Cancel order timing

`cancel_order` only works for orders that have not yet been prepared. Completed orders cannot be cancelled. Old order IDs may expire from the Olo system.

## Authentication

The plugin reads auth state from `localStorage` (`persist:root` key, Redux persist store). The `authtoken` field is used as a path segment for user-specific API endpoints (e.g., `/users/{authtoken}/recentorders`).

The user must be logged in on pandaexpress.com for account-related tools to work. Restaurant search, menu browsing, and basket creation work without authentication.

## API

Panda Express uses [Olo (NomNom)](https://www.olo.com/) for online ordering, proxied through the same origin at `pandaexpress.com`. Key endpoint patterns:

- `/restaurants/near?lat=...&long=...` — restaurant search
- `/restaurants/{id}/menu` — restaurant menu
- `/products/{id}/modifiers` — product modifier options
- `/baskets/create` — create basket
- `/baskets/{id}/products` — add/modify products
- `/baskets/{id}/validate` — checkout validation
- `/users/{authtoken}/recentorders` — order history
- `/orders/{id}/cancel` — cancel order

Loyalty rewards data comes from the Punchh integration, read from the Redux persist store rather than API calls.
