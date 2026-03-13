# Airtable

OpenTabs plugin for Airtable — gives AI agents access to Airtable through your authenticated browser session.

## Install

```bash
opentabs plugin install airtable
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-airtable
```

## Setup

1. Open [airtable.com](https://airtable.com) in Chrome and log in
2. Open the OpenTabs side panel — the Airtable plugin should appear as **ready**

## Tools (8)

### Workspaces (1)

| Tool | Description | Type |
|---|---|---|
| `list_workspaces` | List all workspaces and their bases | Read |

### Bases (1)

| Tool | Description | Type |
|---|---|---|
| `get_base_schema` | Get all tables, fields, and views in a base | Read |

### Records (5)

| Tool | Description | Type |
|---|---|---|
| `list_records` | List all records in a table | Read |
| `get_record` | Get a single record by ID | Read |
| `update_cell` | Update a single cell value in a record | Write |
| `get_record_activity` | Get activity history and comments for a record | Read |
| `create_comment` | Add a comment to a record | Write |

### Fields (1)

| Tool | Description | Type |
|---|---|---|
| `get_field_choices` | Get select/multi-select field choices | Read |

## How It Works

This plugin runs inside your Airtable tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
