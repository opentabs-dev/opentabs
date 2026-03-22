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

The platform packages `@opentabs-dev/shared`, `@opentabs-dev/browser-extension`, `@opentabs-dev/mcp-server`, `@opentabs-dev/plugin-sdk`, `@opentabs-dev/plugin-tools`, `@opentabs-dev/cli`, and `@opentabs-dev/create-plugin` are published as public packages to the npm registry under the `@opentabs-dev` org. Publish order follows the dependency graph: shared → browser-extension → mcp-server → plugin-sdk → plugin-tools → cli → create-plugin. The CLI depends on browser-extension (the Chrome extension is distributed via npm as part of the CLI package).

**Publishing** is automated via the "Publish Platform Packages" GitHub Actions workflow (`.github/workflows/publish-platform.yml`). Go to Actions → "Publish Platform Packages" → Run workflow → enter the version number. The workflow bumps versions, builds, runs quality checks, publishes to npm in dependency order, updates plugin deps, and commits + tags.
