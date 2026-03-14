# Plugin Tools Instructions

## Overview

Plugin developer CLI (`opentabs-plugin`), installed via `npm install -g @opentabs-dev/plugin-tools` or as a dev dependency. Runs on Node.js 22+. Uses esbuild for IIFE bundling. The `opentabs-plugin build` command bundles the plugin adapter into an IIFE, generates `dist/tools.json` (containing tool schemas), auto-registers the plugin in `~/.opentabs/config.json` (under `localPlugins`), and calls `POST /reload` to notify the running MCP server. Supports `--watch` mode for development.

## Key Files

```
platform/plugin-tools/src/
├── cli.ts             # Entry point — `opentabs-plugin` binary
└── commands/
    ├── build.ts       # `opentabs-plugin build` command
    ├── inspect.ts     # `opentabs-plugin inspect` command
    └── readme.ts      # `opentabs-plugin readme` command
```

## SDK Version Compatibility

The `opentabs-plugin build` command embeds the installed `@opentabs-dev/plugin-sdk` version as a top-level `sdkVersion` field in `dist/tools.json`. At discovery time, the MCP server compares the plugin's `sdkVersion` against its own SDK version using major.minor comparison: a plugin's major.minor must be less than or equal to the server's major.minor (patch differences are always fine). If the plugin was built with a newer SDK than the server, it is rejected as a `FailedPlugin` with a clear rebuild message. Plugins that predate this feature (no `sdkVersion` in `tools.json`) load normally with a warning logged — they are not rejected. The `sdkVersion` is surfaced in the `/health` endpoint (server-level and per-plugin), the `opentabs status` CLI command, and the side panel plugin cards (as a warning badge for missing or incompatible versions).

## Build Artifacts

The build command produces two files in `dist/`:

- `adapter.iife.js` — the plugin adapter bundle (IIFE format, injected into matching tabs)
- `tools.json` — tool schemas and `sdkVersion`

The build also auto-registers the plugin in `~/.opentabs/config.json` under `localPlugins` (first build only) and calls `POST /reload` to trigger MCP server rediscovery.

## Config Schema in tools.json

When a plugin's `OpenTabsPlugin` subclass declares a `configSchema` property, `opentabs-plugin build` serializes it into `dist/tools.json` as a top-level `configSchema` field alongside `sdkVersion`, `icons`, and `tools`. If the plugin has no `configSchema` (or it is empty), the field is omitted.

The build command also relaxes the `urlPatterns` non-empty requirement: if `configSchema` contains at least one `required` field of type `'url'`, the plugin may declare an empty `urlPatterns` array — the server derives match patterns at runtime from the user-provided URL setting value.

## README Generation

The `opentabs-plugin readme` command generates a user-facing README.md from `dist/tools.json` and `package.json`. It reads tool metadata (name, group, summary) and plugin metadata (displayName, description, urlPatterns, homepage) to produce a standardized README with install instructions, setup steps, a grouped tool table (Read/Write classified), and a How It Works section.

- `opentabs-plugin readme` — writes README.md
- `opentabs-plugin readme --dry-run` — prints to stdout
- `opentabs-plugin readme --check` — exits 1 if README.md is out of date

AI agents should run this command after adding, removing, or modifying tools to keep the README in sync with the built manifest.
