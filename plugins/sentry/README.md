# Sentry

OpenTabs plugin for Sentry — gives AI agents access to Sentry through your authenticated browser session.

## Install

```bash
opentabs plugin install sentry
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-sentry
```

## Setup

1. Open [sentry.io](https://sentry.io) in Chrome and log in
2. Open the OpenTabs side panel — the Sentry plugin should appear as **ready**

## Tools (21)

### Issues (8)

| Tool | Description | Type |
|---|---|---|
| `search_issues` | Search and list issues with optional filters | Read |
| `get_issue` | Get details for a specific issue | Read |
| `update_issue` | Update issue status, assignee, or other attributes | Write |
| `list_issue_events` | List events for a specific issue | Read |
| `get_event` | Get full details of a specific event | Read |
| `list_issue_tags` | List tag distributions for an issue | Read |
| `list_comments` | List comments on an issue | Read |
| `create_comment` | Add a comment to an issue | Write |

### Projects (4)

| Tool | Description | Type |
|---|---|---|
| `list_projects` | List all projects in the organization | Read |
| `get_project` | Get details for a specific project | Read |
| `get_project_keys` | List DSN keys for a project | Read |
| `list_project_environments` | List project environments | Read |

### Organizations (3)

| Tool | Description | Type |
|---|---|---|
| `list_organizations` | List organizations the user belongs to | Read |
| `get_organization` | Get details for the current organization | Read |
| `list_members` | List organization members | Read |

### Teams (1)

| Tool | Description | Type |
|---|---|---|
| `list_teams` | List teams in the organization | Read |

### Releases (2)

| Tool | Description | Type |
|---|---|---|
| `list_releases` | List releases with optional project filter | Read |
| `get_release` | Get release details by version | Read |

### Alerts (1)

| Tool | Description | Type |
|---|---|---|
| `list_alerts` | List alert rules in the organization | Read |

### Monitors (1)

| Tool | Description | Type |
|---|---|---|
| `list_monitors` | List cron monitors in the organization | Read |

### Replays (1)

| Tool | Description | Type |
|---|---|---|
| `list_replays` | List session replays in the organization | Read |

## How It Works

This plugin runs inside your Sentry tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
