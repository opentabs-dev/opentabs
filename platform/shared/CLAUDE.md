# Shared Package Instructions

## Overview

Shared types and utilities used across platform packages (`@opentabs-dev/shared`). Exports go through `src/index.ts` (the barrel). Not a plugin-author dependency — plugin authors import from `@opentabs-dev/plugin-sdk`.

## Key Files

```
platform/shared/src/
├── index.ts        # Barrel — re-exports everything
├── manifest.ts     # Plugin manifest types (PluginPackageJson, ConfigSchema, etc.)
└── cross-platform.ts # Cross-platform utilities (uses Node.js APIs — never import in browser contexts)
```

## Constants

Key constants exported from `src/constants.ts`:

- **`ADAPTER_FILENAME`** (`'adapter.iife.js'`) — the adapter IIFE built by `opentabs-plugin build` and loaded by the MCP server.
- **`PRE_SCRIPT_FILENAME`** (`'pre-script.iife.js'`) — the pre-script IIFE bundled when `package.json` declares `opentabs.preScript`.
- **`TOOLS_FILENAME`** (`'tools.json'`) — the plugin manifest (tool schemas, preScriptFile/preScriptHash) emitted by the build.
- **`PLUGIN_PREFIX`** (`'opentabs-plugin-'`) — the npm package name prefix for auto-discovery.

## Config Schema Types

The plugin settings system uses these types, all defined in `manifest.ts` and re-exported from `index.ts`:

- **`ConfigSettingType`** — union of allowed field types: `'url' | 'string' | 'number' | 'boolean' | 'select'`
- **`ConfigSettingDefinition`** — a single field definition: `type`, `label`, `description?`, `required?`, `placeholder?`, `options?` (string array, for `select` type)
- **`ConfigSchema`** — `Record<string, ConfigSettingDefinition>`, the full schema map keyed by setting name

These types appear in `PluginOpentabsField` (parsed from `package.json`), `PluginPackageJson`, `LoadedPlugin`, `RegisteredPlugin`, and `ConfigStatePlugin`.

## Browser Context Warning

`cross-platform.ts` uses Node.js APIs (`node:fs/promises`, `node:os`, `node:path`). **Never import from the `@opentabs-dev/shared` barrel in browser-side code** (Chrome extension side panel, adapter IIFEs). esbuild bundles the entire barrel including `cross-platform.ts`, which crashes under Chrome's CSP. Use subpath imports instead:

```ts
import { BROWSER_TOOLS_CATALOG } from '@opentabs-dev/shared/browser-tools-catalog';
import type { TabState } from '@opentabs-dev/shared'; // type-only: safe, erased at compile time
```
