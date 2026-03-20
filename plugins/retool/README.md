# Retool

OpenTabs plugin for Retool — gives AI agents access to Retool through your authenticated browser session.

## Install

```bash
opentabs plugin install retool
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-retool
```

## Setup

1. Open [retool.com](https://retool.com) in Chrome and log in
2. Open the OpenTabs side panel — the Retool plugin should appear as **ready**

## Configuration

Configure settings via `opentabs plugin configure retool` or the side panel.

| Setting | Type | Required | Description |
|---|---|---|---|
| `instanceUrl` | url | No | The URL of your self-hosted Retool instance (e.g., https://retool.example.com). Leave empty to use retool.com. |

## Tools (36)

### Users (2)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the authenticated user profile | Read |
| `change_user_name` | Change the current user name | Write |

### Organization (3)

| Tool | Description | Type |
|---|---|---|
| `get_organization` | Get the current organization details | Read |
| `list_user_spaces` | List accessible user spaces | Read |
| `list_experiments` | List active feature experiments | Read |

### Apps (12)

| Tool | Description | Type |
|---|---|---|
| `list_apps` | List all Retool apps and folders | Read |
| `get_app` | Get app details by UUID | Read |
| `lookup_app` | Look up app by URL path | Write |
| `get_app_docs` | Get app documentation by UUID | Read |
| `list_app_tags` | List version tags for an app | Read |
| `list_page_names` | List all app names and UUIDs (lightweight) | Read |
| `list_page_saves` | List edit history for an app | Read |
| `create_app` | Create a new Retool web app | Write |
| `clone_app` | Clone an existing app | Write |
| `create_folder` | Create a new app or workflow folder | Write |
| `rename_folder` | Rename an app or workflow folder | Write |
| `delete_folder` | Delete an empty folder | Write |

### Resources (4)

| Tool | Description | Type |
|---|---|---|
| `list_resources` | List all configured data resources | Read |
| `create_resource_folder` | Create a new resource folder | Write |
| `delete_resource_folder` | Delete a resource folder | Write |
| `move_resource_to_folder` | Move a resource to a folder | Write |

### Workflows (9)

| Tool | Description | Type |
|---|---|---|
| `list_workflows` | List all workflows and workflow folders | Read |
| `get_workflow` | Get workflow details by ID | Read |
| `list_workflow_runs` | List workflow execution runs | Read |
| `get_workflow_run` | Get workflow run details | Read |
| `get_workflow_run_log` | Get execution logs for a workflow run | Read |
| `list_workflow_triggers` | List triggers for a workflow | Read |
| `get_workflow_releases` | Get workflow release history | Read |
| `get_workflow_run_count` | Get total run counts per workflow | Read |
| `get_workflows_config` | Get global workflow runtime configuration | Read |

### Environments (1)

| Tool | Description | Type |
|---|---|---|
| `list_environments` | List all deployment environments | Read |

### Source Control (2)

| Tool | Description | Type |
|---|---|---|
| `list_branches` | List source control branches | Read |
| `get_source_control_settings` | Get source control configuration | Read |

### Queries (1)

| Tool | Description | Type |
|---|---|---|
| `list_playground_queries` | List saved playground queries | Read |

### Database (1)

| Tool | Description | Type |
|---|---|---|
| `list_grids` | List Retool Database tables | Read |

### Agents (1)

| Tool | Description | Type |
|---|---|---|
| `list_agents` | List all Retool AI agents | Read |

## How It Works

This plugin runs inside your Retool tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
