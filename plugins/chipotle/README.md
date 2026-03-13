# Chipotle

OpenTabs plugin for Chipotle Mexican Grill — gives AI agents access to Chipotle through your authenticated browser session.

## Install

```bash
opentabs plugin install chipotle
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-chipotle
```

## Setup

1. Open [chipotle.com](https://www.chipotle.com) in Chrome and log in
2. Open the OpenTabs side panel — the Chipotle plugin should appear as **ready**

## Tools (16)

### Account (5)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get current user profile and account info | Read |
| `get_loyalty_points` | Get loyalty points balance and reward threshold | Read |
| `get_payment_methods` | List saved payment cards and gift cards | Read |
| `get_promotions` | Get available promotions and coupon codes | Read |
| `get_ordering_status` | Check online ordering availability flags | Read |

### Stores (2)

| Tool | Description | Type |
|---|---|---|
| `find_restaurants` | Find nearby Chipotle locations by coordinates | Read |
| `get_restaurant` | Get restaurant details with hours and status | Read |

### Menu (3)

| Tool | Description | Type |
|---|---|---|
| `get_menu` | Get restaurant menu with prices and calories | Read |
| `get_menu_groups` | Get menu categories from local page state | Read |
| `get_preconfigured_meals` | Get preconfigured meal options for a restaurant | Read |

### Orders (3)

| Tool | Description | Type |
|---|---|---|
| `get_recent_orders` | Get recent order history with meal details | Read |
| `get_favorites` | Get saved favorite meals for a restaurant | Read |
| `get_last_restaurant` | Get the last restaurant ordered from | Read |

### Rewards (3)

| Tool | Description | Type |
|---|---|---|
| `get_rewards` | Get available rewards and point costs | Read |
| `get_reward_categories` | Get reward store offer categories | Read |
| `get_extras_campaigns` | Get Extras bonus reward campaigns | Read |

## How It Works

This plugin runs inside your Chipotle tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
