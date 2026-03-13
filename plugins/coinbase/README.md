# Coinbase

OpenTabs plugin for Coinbase — gives AI agents access to Coinbase through your authenticated browser session.

## Install

```bash
opentabs plugin install coinbase
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-coinbase
```

## Setup

1. Open [coinbase.com](https://www.coinbase.com/home) in Chrome and log in
2. Open the OpenTabs side panel — the Coinbase plugin should appear as **ready**

## Tools (17)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the authenticated user profile | Read |

### Portfolio (1)

| Tool | Description | Type |
|---|---|---|
| `list_portfolios` | List all portfolios | Read |

### Assets (5)

| Tool | Description | Type |
|---|---|---|
| `get_asset_by_uuid` | Get asset details by UUID | Read |
| `get_asset_by_slug` | Get asset details by URL slug | Read |
| `get_asset_by_symbol` | Get asset details by ticker symbol | Read |
| `get_asset_categories` | Get categories for an asset | Read |
| `get_asset_networks` | Get supported networks for an asset | Read |

### Prices (2)

| Tool | Description | Type |
|---|---|---|
| `get_asset_price` | Get current price for an asset | Read |
| `compare_asset_prices` | Compare prices of multiple assets | Write |

### Watchlists (5)

| Tool | Description | Type |
|---|---|---|
| `list_watchlists` | List all watchlists | Read |
| `create_watchlist` | Create a new watchlist | Write |
| `delete_watchlist` | Delete a watchlist | Write |
| `add_watchlist_item` | Add an asset to a watchlist | Write |
| `remove_watchlist_item` | Remove an asset from a watchlist | Write |

### Alerts (3)

| Tool | Description | Type |
|---|---|---|
| `list_price_alerts` | List all price alerts | Read |
| `create_price_alert` | Create a price alert for an asset | Write |
| `delete_price_alert` | Delete a price alert | Write |

## How It Works

This plugin runs inside your Coinbase tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
