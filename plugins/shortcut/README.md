# Shortcut

OpenTabs plugin for Shortcut — gives AI agents access to Shortcut through your authenticated browser session.

## Install

```bash
opentabs plugin install shortcut
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-shortcut
```

## Setup

1. Open [app.shortcut.com](https://app.shortcut.com) in Chrome and log in
2. Open the OpenTabs side panel — the Shortcut plugin should appear as **ready**

## Tools (27)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get current user profile | Read |

### Stories (8)

| Tool | Description | Type |
|---|---|---|
| `search_stories` | Search stories by text query | Read |
| `get_story` | Get a story by ID | Read |
| `create_story` | Create a new story | Write |
| `update_story` | Update a story | Write |
| `delete_story` | Delete a story | Write |
| `list_story_comments` | List comments on a story | Read |
| `create_story_comment` | Add a comment to a story | Write |
| `create_story_link` | Link two stories together | Write |

### Epics (7)

| Tool | Description | Type |
|---|---|---|
| `list_epics` | List all epics | Read |
| `get_epic` | Get an epic by ID | Read |
| `create_epic` | Create a new epic | Write |
| `update_epic` | Update an epic | Write |
| `delete_epic` | Delete an epic | Write |
| `list_epic_stories` | List stories in an epic | Read |
| `search_epics` | Search epics by text | Read |

### Labels (2)

| Tool | Description | Type |
|---|---|---|
| `list_labels` | List all labels | Read |
| `create_label` | Create a new label | Write |

### Workflows (1)

| Tool | Description | Type |
|---|---|---|
| `list_workflows` | List workflows with their states | Read |

### Members (1)

| Tool | Description | Type |
|---|---|---|
| `list_members` | List workspace members | Read |

### Teams (1)

| Tool | Description | Type |
|---|---|---|
| `list_teams` | List all teams | Read |

### Iterations (5)

| Tool | Description | Type |
|---|---|---|
| `list_iterations` | List all iterations | Read |
| `get_iteration` | Get an iteration by ID | Read |
| `create_iteration` | Create a new iteration | Write |
| `update_iteration` | Update an iteration | Write |
| `list_iteration_stories` | List stories in an iteration | Read |

### Objectives (1)

| Tool | Description | Type |
|---|---|---|
| `list_objectives` | List all objectives | Read |

## How It Works

This plugin runs inside your Shortcut tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
