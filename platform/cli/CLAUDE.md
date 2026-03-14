# CLI Instructions

## Overview

User-facing CLI (`opentabs`), installed via `npm install -g @opentabs-dev/cli`. Runs on Node.js 22+. Commands: `start`, `status`, `audit`, `doctor`, `logs`, `plugin create/search`, `config show/set/path`. The `opentabs start` command auto-initializes config and the Chrome extension on first run, then launches the MCP server (via `node`). The `opentabs logs --plugin <name>` flag filters output to only show logs from a specific plugin. The `opentabs audit` command shows recent tool invocation history from the server's audit log. The `opentabs plugin search [query]` command searches the npm registry for available plugins.

## Key Files

```
platform/cli/src/
├── cli.ts         # Entry point — `opentabs` binary
└── commands/      # start, status, doctor, logs, plugin, config
```

## Plugin Settings Commands

**`opentabs plugin configure <name>`**: Interactive CLI command that prompts the user for each field defined in the plugin's `configSchema`. Shows the current value as a default (press Enter to keep). Validates URL fields with `new URL()`, select fields by allowed options, boolean fields (yes/no), and number fields. Saves to `config.json` under `settings.<pluginShortName>` and notifies the server via `POST /reload`.

**`opentabs config set setting.<plugin>.<key> <value>`**: Non-interactive counterpart. Sets a single setting value. Pass an empty string to remove the key. Updated `config show` output includes a `settings` section; `config show --json` includes settings in the JSON output.

**`opentabs plugin list`**: Shows a `⚙ needs setup` indicator (yellow) for plugins with a `configSchema` that has required fields not yet configured, as reported by the `/health` endpoint's `pluginDetails[].needsSetup` field.

## Publishing Platform Packages

The platform packages `@opentabs-dev/shared`, `@opentabs-dev/browser-extension`, `@opentabs-dev/mcp-server`, `@opentabs-dev/plugin-sdk`, `@opentabs-dev/plugin-tools`, `@opentabs-dev/cli`, and `@opentabs-dev/create-plugin` are published as private packages to the npm registry under the `@opentabs-dev` org. Publish order follows the dependency graph: shared → browser-extension → mcp-server → plugin-sdk → plugin-tools → cli → create-plugin. The CLI depends on browser-extension (the Chrome extension is distributed via npm as part of the CLI package).

**Authentication**: npm requires a single token in `~/.npmrc` with read+write access to `@opentabs-dev` packages.

**Setup (one-time)**:

```bash
# Create a granular access token at https://www.npmjs.com/settings/tokens/create
# Permissions: Read and Write, Packages: @opentabs-dev/*, Bypass 2FA enabled
echo '//registry.npmjs.org/:_authToken=<TOKEN>' > ~/.npmrc
```

**NEVER change npm package access levels** (public/private) without explicit user approval. All `@opentabs-dev` packages are private. Do not run `npm access set status=public` or equivalent commands.

**Publishing** (uses `scripts/publish.sh` which verifies auth via `npm whoami` before publishing):

```bash
./scripts/publish.sh 0.0.3
# Then update plugin deps and rebuild:
# cd plugins/<name> && npm install && npm run build
```
