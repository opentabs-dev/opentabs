# New Relic

OpenTabs plugin for New Relic — gives AI agents access to New Relic through your authenticated browser session.

## Install

```bash
opentabs plugin install newrelic
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-newrelic
```

## Setup

1. Open [one.newrelic.com](https://one.newrelic.com) in Chrome and log in
2. Open the OpenTabs side panel — the New Relic plugin should appear as **ready**

## Tools (22)

### Account (3)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |
| `list_accounts` | List accessible accounts | Read |
| `get_organization` | Get organization details | Read |

### Entities (5)

| Tool | Description | Type |
|---|---|---|
| `search_entities` | Search monitored entities | Read |
| `get_entity` | Get entity details by GUID | Read |
| `list_entity_tags` | List tags on an entity | Read |
| `add_entity_tags` | Add tags to an entity | Write |
| `delete_entity_tags` | Delete tags from an entity | Write |

### NRQL (2)

| Tool | Description | Type |
|---|---|---|
| `run_nrql_query` | Execute a NRQL query | Write |
| `list_event_types` | List available event types for NRQL | Read |

### Dashboards (5)

| Tool | Description | Type |
|---|---|---|
| `list_dashboards` | List dashboards | Read |
| `get_dashboard` | Get dashboard details by GUID | Read |
| `create_dashboard` | Create a new dashboard | Write |
| `update_dashboard` | Update an existing dashboard | Write |
| `delete_dashboard` | Delete a dashboard | Write |

### Alerts (7)

| Tool | Description | Type |
|---|---|---|
| `list_alert_policies` | List alert policies | Read |
| `create_alert_policy` | Create an alert policy | Write |
| `delete_alert_policy` | Delete an alert policy | Write |
| `list_nrql_conditions` | List NRQL alert conditions | Read |
| `create_nrql_condition` | Create a NRQL alert condition | Write |
| `update_nrql_condition` | Update a NRQL alert condition | Write |
| `delete_nrql_condition` | Delete a NRQL alert condition | Write |

## How It Works

This plugin runs inside your New Relic tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
