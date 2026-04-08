# Datadog

OpenTabs plugin for Datadog — monitors, dashboards, logs, APM, metrics, SLOs, incidents, and more — gives AI agents access to Datadog through your authenticated browser session.

## Install

```bash
opentabs plugin install datadog
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-datadog
```

## Setup

1. Open [datadoghq.com](https://app.datadoghq.com) in Chrome and log in
2. Open the OpenTabs side panel — the Datadog plugin should appear as **ready**

## Tools (71)

### Monitors (13)

| Tool | Description | Type |
|---|---|---|
| `list_monitors` | List Datadog monitors with optional tag filters | Read |
| `get_monitor` | Get a monitor by ID | Read |
| `search_monitors` | Search monitors by name, status, tags, or type | Read |
| `mute_monitor` | Mute a monitor to suppress alerts | Write |
| `unmute_monitor` | Unmute a monitor to resume alerts | Write |
| `delete_monitor` | Delete a monitor by ID | Write |
| `list_monitor_tags` | List tags used by monitors | Read |
| `get_monitor_groups` | Get group statuses for a multi-alert monitor | Read |
| `get_monitor_state_history` | Get monitor evaluation preview over time | Read |
| `create_monitor` | Create a new monitor | Write |
| `update_monitor` | Update a monitor | Write |
| `list_monitor_downtimes` | Get downtimes for a monitor | Read |
| `clone_monitor` | Clone a monitor with optional overrides | Write |

### Dashboards (6)

| Tool | Description | Type |
|---|---|---|
| `list_dashboards` | List all Datadog dashboards | Read |
| `get_dashboard` | Get a dashboard by ID | Read |
| `search_dashboards` | Search dashboards by name | Read |
| `search_dashboards_advanced` | Search dashboards with author filter | Read |
| `delete_dashboard` | Delete a dashboard by ID | Write |
| `clone_dashboard` | Clone a dashboard with optional overrides | Write |

### SLOs (5)

| Tool | Description | Type |
|---|---|---|
| `list_slos` | List Datadog SLOs | Read |
| `get_slo` | Get an SLO by ID | Read |
| `get_slo_history` | Get SLO history and error budget | Read |
| `search_slos` | Search SLOs by name | Read |
| `list_slo_corrections` | List SLO corrections | Read |

### Logs (1)

| Tool | Description | Type |
|---|---|---|
| `search_logs` | Search logs with Datadog query syntax | Read |

### APM (4)

| Tool | Description | Type |
|---|---|---|
| `search_spans` | Search APM spans with Datadog query syntax | Read |
| `get_trace` | Get a full APM trace by ID | Read |
| `aggregate_spans` | Aggregate APM span data with grouping | Write |
| `get_service_dependencies` | Get service dependency map | Read |

### Metrics (5)

| Tool | Description | Type |
|---|---|---|
| `query_metrics` | Query metric time-series data | Read |
| `list_metrics` | List available metric names | Read |
| `get_metric_metadata` | Get metric description, type, and unit info | Read |
| `query_timeseries` | Run advanced timeseries queries with formulas | Read |
| `list_metric_tags` | List tags for a metric | Read |

### Infrastructure (6)

| Tool | Description | Type |
|---|---|---|
| `list_hosts` | List infrastructure hosts | Read |
| `mute_host` | Mute a host to suppress alerts | Write |
| `unmute_host` | Unmute a host | Write |
| `get_host_totals` | Get total active/up host counts | Read |
| `list_host_tags` | List tags for a host | Read |
| `get_host_info` | Get host details by name | Read |

### Services (3)

| Tool | Description | Type |
|---|---|---|
| `list_services` | List services from the service catalog | Read |
| `get_service_definition` | Get service definition by name | Read |
| `search_services` | Search the service catalog | Read |

### Notebooks (6)

| Tool | Description | Type |
|---|---|---|
| `list_notebooks` | List Datadog notebooks | Read |
| `get_notebook` | Get a notebook by ID | Read |
| `search_notebooks` | Search notebooks by name | Read |
| `create_notebook` | Create a new notebook | Write |
| `update_notebook` | Update a notebook | Write |
| `delete_notebook` | Delete a notebook by ID | Write |

### Synthetics (5)

| Tool | Description | Type |
|---|---|---|
| `list_synthetics_tests` | List synthetic monitoring tests | Read |
| `get_synthetics_test` | Get a synthetic test by ID | Read |
| `get_synthetics_results` | Get recent synthetic test results | Read |
| `trigger_synthetics_test` | Trigger a synthetic test run | Write |
| `pause_synthetics_test` | Pause or resume a synthetic test | Write |

### Downtimes (4)

| Tool | Description | Type |
|---|---|---|
| `list_downtimes` | List maintenance windows | Read |
| `get_downtime` | Get a downtime by ID | Read |
| `cancel_downtime` | Cancel a scheduled downtime | Write |
| `create_downtime` | Schedule a new downtime | Write |

### Users (3)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get current user profile | Read |
| `list_users` | List organization users | Read |
| `get_user` | Get a user by UUID | Read |

### RUM (2)

| Tool | Description | Type |
|---|---|---|
| `search_rum_events` | Search RUM events with query syntax | Read |
| `aggregate_rum_events` | Aggregate RUM event data with grouping | Write |

### Incidents (2)

| Tool | Description | Type |
|---|---|---|
| `list_incidents` | List Datadog incidents | Read |
| `get_incident` | Get an incident by ID | Read |

### Teams (1)

| Tool | Description | Type |
|---|---|---|
| `list_teams` | List teams | Read |

### Security (1)

| Tool | Description | Type |
|---|---|---|
| `search_security_signals` | Search security signals | Read |

### Admin (4)

| Tool | Description | Type |
|---|---|---|
| `get_permissions` | List available permissions | Read |
| `get_org_config` | Get org configuration | Read |
| `list_api_keys` | List API keys | Read |
| `get_usage_summary` | Get org usage summary | Read |

## How It Works

This plugin runs inside your Datadog tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
