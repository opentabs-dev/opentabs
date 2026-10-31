# Overleaf

Read Overleaf projects and source, search files, and obtain a fresh compiled PDF — gives AI agents access to Overleaf through your authenticated browser session.

## Install

```bash
opentabs plugin install overleaf
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-overleaf
```

## Setup

1. Open [www.overleaf.com](https://www.overleaf.com/project) in Chrome and log in
2. Open the OpenTabs side panel — the Overleaf plugin should appear as **ready**

## Tools (5)

### Projects (2)

| Tool | Description | Type |
|---|---|---|
| `list_projects` | List projects and access metadata | Read |
| `get_project` | Read project settings and the ID-bearing file tree | Read |

### Source (2)

| Tool | Description | Type |
|---|---|---|
| `read_file` | Read saved text with an optional line range | Read |
| `search_project` | Search saved source with explicit coverage limits | Read |

### Output (1)

| Tool | Description | Type |
|---|---|---|
| `get_pdf` | Compile saved source and return a current PDF URL | Read |

## How It Works

This plugin runs inside your Overleaf tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
