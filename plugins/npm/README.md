# npm

OpenTabs plugin for npm registry — gives AI agents access to npm through your authenticated browser session.

## Install

```bash
opentabs plugin install npm
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-npm
```

## Setup

1. Open [www.npmjs.com](https://www.npmjs.com) in Chrome and log in
2. Open the OpenTabs side panel — the npm plugin should appear as **ready**

## Tools (14)

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the authenticated npm user profile | Read |

### Packages (8)

| Tool | Description | Type |
|---|---|---|
| `search_packages` | Search the npm registry for packages | Read |
| `get_package` | Get npm package details | Read |
| `get_package_version` | Get details for a specific package version | Read |
| `get_package_readme` | Get the README of a package | Read |
| `get_package_downloads` | Get download stats for a package | Read |
| `get_package_dependents` | Get packages depending on a package | Read |
| `get_package_versions` | List all versions of a package | Read |
| `get_package_dependencies` | Get dependencies of a package | Read |

### Users (2)

| Tool | Description | Type |
|---|---|---|
| `get_user_profile` | Get an npm user profile | Read |
| `get_user_packages` | List packages by a user | Read |

### Organizations (1)

| Tool | Description | Type |
|---|---|---|
| `get_organization` | Get npm organization details | Read |

### Settings (2)

| Tool | Description | Type |
|---|---|---|
| `list_user_packages` | List your own packages | Read |
| `list_tokens` | List your npm access tokens | Read |

## How It Works

This plugin runs inside your npm tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
