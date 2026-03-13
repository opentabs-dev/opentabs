# Craigslist

OpenTabs plugin for Craigslist — gives AI agents access to Craigslist through your authenticated browser session.

## Install

```bash
opentabs plugin install craigslist
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-craigslist
```

## Setup

1. Open [craigslist.org](https://accounts.craigslist.org/) in Chrome and log in
2. Open the OpenTabs side panel — the Craigslist plugin should appear as **ready**

## Tools (9)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |

### Chat (2)

| Tool | Description | Type |
|---|---|---|
| `list_chat_conversations` | List chat conversations | Read |
| `get_chat_messages` | Get messages in a chat conversation | Read |

### Billing (3)

| Tool | Description | Type |
|---|---|---|
| `list_payment_cards` | List saved payment cards | Read |
| `delete_payment_card` | Delete a saved payment card | Write |
| `set_default_payment_card` | Set a card as the default payment method | Write |

### Postings (2)

| Tool | Description | Type |
|---|---|---|
| `list_renewable_postings` | List postings eligible for renewal | Read |
| `renew_all_postings` | Bulk renew all eligible postings | Write |

### Searches (1)

| Tool | Description | Type |
|---|---|---|
| `get_saved_search_counts` | Get counts for saved searches | Read |

## How It Works

This plugin runs inside your Craigslist tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
