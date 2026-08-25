# Figma

OpenTabs plugin for Figma — gives AI agents access to Figma through your authenticated browser session.

## Install

```bash
opentabs plugin install figma
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-figma
```

## Setup

1. Open [figma.com](https://www.figma.com/files/recents-and-sharing) in Chrome and log in
2. Open the OpenTabs side panel — the Figma plugin should appear as **ready**

## Tools (15)

### Users (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |

### Teams (3)

| Tool | Description | Type |
|---|---|---|
| `list_teams` | List teams the user belongs to | Read |
| `get_team_info` | Get details about a team | Read |
| `list_team_projects` | List projects in a team | Read |

### Files (8)

| Tool | Description | Type |
|---|---|---|
| `list_files` | List files in a folder or project | Read |
| `get_file` | Get metadata for a file | Read |
| `get_file_components` | List components in a file | Read |
| `list_file_versions` | List file version history | Read |
| `create_file` | Create a new design file | Write |
| `update_file` | Update a file name or description | Write |
| `trash_file` | Move a file to the trash | Write |
| `list_recent_files` | List recently accessed files | Read |

### Layers (1)

| Tool | Description | Type |
|---|---|---|
| `get_layer_tree` | Read the active page layer tree | Read |

### Comments (2)

| Tool | Description | Type |
|---|---|---|
| `list_comments` | List comments on a file | Read |
| `post_comment` | Add a comment to a file | Write |

## How It Works

This plugin runs inside your Figma tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
