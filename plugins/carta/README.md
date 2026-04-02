# Carta

OpenTabs plugin for Carta — gives AI agents access to Carta through your authenticated browser session.

## Install

```bash
opentabs plugin install carta
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-carta
```

## Setup

1. Open [app.carta.com](https://app.carta.com) in Chrome and log in
2. Open the OpenTabs side panel — the Carta plugin should appear as **ready**

## Tools (20)

### User (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get current user profile | Read |

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `list_accounts` | List user accounts | Read |

### Portfolio (4)

| Tool | Description | Type |
|---|---|---|
| `list_companies` | List portfolio companies | Read |
| `get_company_profile` | Get company profile details | Read |
| `get_entities` | Get portfolio entity details | Read |
| `check_favourite` | Check if company is favourited | Read |

### Holdings (9)

| Tool | Description | Type |
|---|---|---|
| `get_holdings_dashboard` | Get holdings summary for a company | Read |
| `list_options` | List stock option grants | Read |
| `list_shares` | List share certificates | Read |
| `list_rsus` | List RSU grants | Read |
| `list_equity_grants` | List all equity grants | Read |
| `list_convertibles` | List convertible instruments | Read |
| `list_warrants` | List warrants | Read |
| `list_sars` | List stock appreciation rights | Read |
| `list_pius` | List profits interest units | Read |

### Documents (2)

| Tool | Description | Type |
|---|---|---|
| `get_tax_documents` | Get tax documents | Read |
| `get_witness_signatures` | Get witness signature requests | Read |

### Tax (1)

| Tool | Description | Type |
|---|---|---|
| `get_qsbs_eligibility` | Get QSBS eligible shares | Read |

### Tasks (1)

| Tool | Description | Type |
|---|---|---|
| `get_tasks` | Get pending action items | Read |

### Communication (1)

| Tool | Description | Type |
|---|---|---|
| `get_inbox_count` | Get unread inbox count | Read |

## How It Works

This plugin runs inside your Carta tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
