# Booking.com

OpenTabs plugin for Booking.com — gives AI agents access to Booking.com through your authenticated browser session.

## Install

```bash
opentabs plugin install booking
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-booking
```

## Setup

1. Open [booking.com](https://www.booking.com) in Chrome and log in
2. Open the OpenTabs side panel — the Booking.com plugin should appear as **ready**

## Tools (10)

### Account (2)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the logged-in user profile | Read |
| `get_genius_status` | Get Genius loyalty program details | Read |

### Search (2)

| Tool | Description | Type |
|---|---|---|
| `search_properties` | Search for properties by destination and dates | Read |
| `search_destinations` | Search for travel destinations | Read |

### Properties (2)

| Tool | Description | Type |
|---|---|---|
| `get_property` | Get property details by name and location | Read |
| `get_property_reviews` | Get property review scores | Read |

### Trips (1)

| Tool | Description | Type |
|---|---|---|
| `list_trips` | List user trips and bookings | Read |

### Wishlists (1)

| Tool | Description | Type |
|---|---|---|
| `list_wishlists` | List saved wishlists | Read |

### Navigation (2)

| Tool | Description | Type |
|---|---|---|
| `navigate_to_property` | Open a property page in the browser | Write |
| `navigate_to_search` | Open search results in the browser | Write |

## How It Works

This plugin runs inside your Booking.com tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
