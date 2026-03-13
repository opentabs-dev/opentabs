# Walmart

OpenTabs plugin for Walmart — gives AI agents access to Walmart through your authenticated browser session.

## Install

```bash
opentabs plugin install walmart
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-walmart
```

## Setup

1. Open [walmart.com](https://www.walmart.com) in Chrome and log in
2. Open the OpenTabs side panel — the Walmart plugin should appear as **ready**

## Tools (10)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the authenticated Walmart user profile | Read |

### Products (5)

| Tool | Description | Type |
|---|---|---|
| `search_products` | Search for products on Walmart | Read |
| `get_product` | Get product details by item ID | Read |
| `get_product_reviews` | Get product reviews by item ID | Read |
| `navigate_to_product` | Open a product page in the browser | Write |
| `navigate_to_search` | Open search results in the browser | Write |

### Stores (1)

| Tool | Description | Type |
|---|---|---|
| `get_store` | Get store details by store number | Read |

### Orders (1)

| Tool | Description | Type |
|---|---|---|
| `list_orders` | List recent purchase history | Read |

### Cart (2)

| Tool | Description | Type |
|---|---|---|
| `get_cart` | View current cart contents | Read |
| `navigate_to_checkout` | Navigate to checkout page | Write |

## How It Works

This plugin runs inside your Walmart tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
