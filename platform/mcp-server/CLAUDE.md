# MCP Server Instructions

## Overview

Discovers plugins, registers their tools as MCP capabilities, dispatches tool calls to the Chrome extension via WebSocket, receives plugin log entries and forwards them to MCP clients via the logging capability, converts tool progress notifications into MCP `notifications/progress` events, and serves health/config endpoints. The server maintains an in-memory audit log of the last 500 tool invocations, queryable via `GET /audit` (with Bearer auth), with aggregate stats included in the `/health` response's `auditSummary` field.

## Key Files

```
platform/mcp-server/src/
├── index.ts              # Entry point (HTTP + WebSocket server, hot reload)
├── dev-proxy.ts          # Dev proxy: holds connections, restarts worker on dist/ changes
├── dev-mode.ts           # Dev mode detection (--dev flag / OPENTABS_DEV env var)
├── config.ts             # ~/.opentabs/config.json management + auth.json secret handling
├── discovery.ts          # Discovery orchestrator (resolve → load → register)
├── resolver.ts           # Plugin specifier resolution (npm + local paths)
├── loader.ts             # Plugin artifact loading (package.json, IIFE, tools.json)
├── registry.ts           # Immutable PluginRegistry with O(1) tool lookup
├── extension-protocol.ts # JSON-RPC protocol with Chrome extension
├── mcp-setup.ts          # MCP tool registration from discovered plugins
├── state.ts              # In-memory server state (PluginRegistry)
├── log-buffer.ts         # Per-plugin circular log buffer (last 1000 entries)
├── file-watcher.ts       # Watches local plugin dist/ directories (dev mode only)
└── version-check.ts      # npm update checks for installed plugins
```

## Plugin Discovery

The MCP server discovers plugins from two sources: (1) **npm auto-discovery** scans global `node_modules` for packages matching `opentabs-plugin-*` and `@*/opentabs-plugin-*` patterns, and (2) **local plugins** listed in the `localPlugins` array in `~/.opentabs/config.json` (filesystem paths to plugins under active development). Each discovered plugin is loaded by reading `package.json` (with an `opentabs` field for metadata), `dist/adapter.iife.js` (the adapter bundle), and `dist/tools.json` (tool schemas). Local plugins override npm plugins of the same name. Discovery is a four-phase pipeline: resolve → load → merge → build an immutable registry.

## Dispatch Pipeline

### Tool Dispatch

**Tab targeting**: `getAllToolsList` (in `mcp-setup.ts`) injects an optional `tabId` integer property into every plugin tool's input schema via `structuredClone` — the original `ManifestTool.input_schema` is never mutated. `handlePluginToolCall` (in `mcp-tool-dispatch.ts`) extracts `tabId` from args before Ajv validation and threads it as a top-level field in `ToolDispatchParams` sent to the extension. Plugin tool handlers never see `tabId` in their input — it is a platform concern. Use `plugin_list_tabs` to discover valid tab IDs.

Tool dispatch uses a 30s timeout (`DISPATCH_TIMEOUT_MS`) by default. When a tool reports progress, the timeout resets to 30s from the last progress notification — so a tool that reports progress at least once every 30s will never time out. An absolute ceiling of 5 minutes (`MAX_DISPATCH_TIMEOUT_MS = 300_000`) applies regardless of progress, preventing indefinitely running tools. The extension has a matching `MAX_SCRIPT_TIMEOUT_MS` (295s, 5s less than the server max) to ensure the extension always responds before the server times out.

### Progress Reporting

Long-running tools can report incremental progress to MCP clients via an optional second argument to `handle()`. The `handle(params, context?)` signature provides a `ToolHandlerContext` with a `reportProgress({ progress, total, message? })` callback. Progress flows from the adapter (MAIN world `CustomEvent`) → ISOLATED world content script relay → `chrome.runtime.sendMessage` → extension background → WebSocket `tool.progress` JSON-RPC notification → MCP server → `notifications/progress` to MCP clients. The wire format from extension to server is `{ jsonrpc: '2.0', method: 'tool.progress', params: { dispatchId, progress, total, message? } }`. The `dispatchId` correlates progress back to the pending dispatch via the JSON-RPC request ID. Progress notifications are fire-and-forget — errors in the progress chain do not affect the tool result. The MCP server only emits `notifications/progress` if the MCP client included a `progressToken` in the tools/call request's `_meta`; otherwise progress is silently dropped.

## Plugin Logging

The plugin SDK exports a `log` namespace (`log.debug`, `log.info`, `log.warn`, `log.error`) that routes structured log entries from plugin tool handlers and lifecycle hooks through the platform to MCP clients and the CLI. The transport chain is: adapter IIFE (page context) → `window.postMessage` → ISOLATED world relay script → `chrome.runtime.sendMessage` → background service worker → WebSocket `plugin.log` JSON-RPC → MCP server → `sendLoggingMessage` to MCP clients + `console.log` to `server.log`. The MCP server maintains a per-plugin circular buffer (1000 entries) for log entries, exposed via the `/health` endpoint's `pluginDetails[].logBufferSize` field. When running outside the adapter runtime (e.g., unit tests), the logger falls back to `console` methods. The adapter IIFE wrapper sets up the log transport via `_setLogTransport()` (accessed through `globalThis.__openTabs._setLogTransport` to avoid SDK version mismatches) and batches entries (flush every 100ms or 50 entries).

## Dev vs Production Mode

The MCP server operates in two modes, controlled by the `--dev` CLI flag or `OPENTABS_DEV=1` environment variable. **Production mode** (default) runs `node dist/index.js`, performs static plugin discovery at startup with no file watchers and no config watching, and uses `node:http` + `ws` for the HTTP+WebSocket server. **Dev mode** runs via the dev proxy (`node dist/dev-proxy.js`), enables file watchers for local plugin `dist/` directories, config file watching. The `POST /reload` endpoint is available in both modes (behind bearer auth and rate limiting), allowing `opentabs-plugin build` to trigger rediscovery in either mode. The mode is determined once at startup in `dev-mode.ts` and accessible via `isDev()`.

### Hot Reload (Dev Mode Only)

In dev mode, the MCP server runs behind a thin proxy (`src/dev-proxy.ts`). The proxy holds all HTTP and WebSocket connections while watching `dist/` for `.js` file changes. On change (debounced 300ms), the proxy kills the current worker process and forks a new one. The new worker starts on an ephemeral port (PORT=0), signals its actual port to the proxy via IPC (`process.send({ type: 'ready', port })`), and the proxy resumes forwarding traffic. Incoming HTTP requests are buffered during restart (up to 5 seconds, then 503). The `globalThis`-based state pattern in `index.ts` is preserved for consistency but is effectively unused since each worker gets a clean process.

Hot reload is a platform contributor feature — production users run the server via `opentabs start` (Node.js with no proxy). In both modes, the `POST /reload` endpoint triggers plugin rediscovery without restarting the process.

## Authentication and Secrets

The WebSocket secret is stored exclusively in `~/.opentabs/extension/auth.json` as `{ "secret": "<hex>" }`. This file is the single source of truth — `config.json` does not store the secret. On startup, the MCP server calls `loadSecret()` which reads the secret from `auth.json`, or generates a new one and writes `auth.json` if it doesn't exist. The secret is also re-read on every config reload (`reloadCore`) so that `opentabs config rotate-secret` takes effect without restarting the server. CLI commands (`status`, `audit`, `plugin reload`) and `opentabs-plugin build` read the secret from `auth.json` via their own helper functions. Secret rotation is done via `opentabs config rotate-secret`, which generates a new secret, writes it to `auth.json`, and notifies the running server via `POST /reload`. The server detects the secret change in `reloadCore` and sends `extension.reload` over the existing WebSocket, causing the extension to restart and reconnect with the new credentials automatically.

## Browser Tools

The MCP server registers built-in browser tools (`platform/mcp-server/src/browser-tools/`) that operate on Chrome tabs via the extension's WebSocket connection. These tools are always available regardless of installed plugins. They cover tab management (`browser_open_tab`, `browser_list_tabs`, `browser_close_tab`), page interaction (`browser_click_element`, `browser_type_text`, `browser_execute_script`), inspection (`browser_get_tab_content`, `browser_get_page_html`, `browser_screenshot_tab`, `browser_query_elements`), storage and cookies (`browser_get_storage`, `browser_get_cookies`), network capture (`browser_enable_network_capture`, `browser_get_network_requests`), extension diagnostics (`extension_get_state`, `extension_get_logs`), and plugin tab discovery (`plugin_list_tabs`). Each browser tool is defined using `defineBrowserTool()` with a Zod schema and handler function.

`plugin_list_tabs` lists all open tabs matching a plugin's URL patterns, with per-tab readiness. It reads directly from `state.tabMapping` (server-side, no extension round-trip) and accepts an optional `plugin` parameter to filter by plugin name. Use it to discover tab IDs before using the `tabId` parameter on plugin tools.

## Plugin Review System

The MCP server implements a plugin code review flow that ensures plugins are reviewed before use. The system consists of two platform tools, a review token mechanism, and per-version review tracking.

### Platform Tools

**`plugin_inspect`**: Retrieves a plugin's adapter IIFE source code for security review. Accepts `{ plugin: string }`, reads the adapter file from disk (`<pluginPath>/dist/adapter.iife.js`), and returns the full source code with metadata (name, version, author, npm package, line count, byte size), a review token, and comprehensive security review guidance. Returns an error if the plugin doesn't exist or has no adapter file.

**`plugin_mark_reviewed`**: Marks a plugin as reviewed and sets its permission. Accepts `{ plugin: string, version: string, reviewToken: string, permission: 'ask' | 'auto' }`. Validates the review token (must be valid, not expired, not used, matching plugin and version), then consumes the token, sets the permission and `reviewedVersion` in state, persists to config, and sends `tools/list_changed` and `plugins.changed` notifications. Returns an error for invalid tokens or `permission: 'off'`.

Both tools are registered as platform tools in `mcp-setup.ts` — they bypass permission checks, are always available, and are hidden from the side panel (excluded from `buildConfigStatePayload`).

### Review Tokens

Review tokens enforce that `plugin_inspect` must be called before `plugin_mark_reviewed`. Tokens are stored in `state.reviewTokens` (in-memory `Map<string, ReviewToken>`). Each token records the plugin name, version, creation time, and used flag. Tokens expire after 10 minutes (TTL). Expired tokens are lazily cleaned up on each `generateReviewToken` call. Token functions: `generateReviewToken(state, plugin, version)`, `validateReviewToken(state, token, plugin, version)`, `consumeReviewToken(state, token)` — all in `state.ts`.

### Version Reset

During `reloadCore`, `resetStaleReviewedVersions` iterates `state.pluginPermissions` and compares each plugin's `reviewedVersion` against the registry's installed version. On mismatch, the permission resets to `'off'` and `reviewedVersion` is cleared, then persisted via `savePluginPermissions`. This ensures plugin updates force re-review. The browser pseudo-plugin is excluded from this check.

### Off-Plugin Error Messages

When an agent calls a tool on a plugin with permission `'off'`, the error response includes review flow instructions: the plugin name, version, guidance to call `plugin_inspect`, and a note about the side panel alternative. The message distinguishes between fresh plugins ("has not been reviewed yet") and updated plugins ("has been updated from vX to vY and needs re-review"). Browser tools use a simpler message without review flow instructions.

## Site Analysis Tool

`plugin_analyze_site` is a high-level browser tool that comprehensively analyzes a web page to produce actionable intelligence for building OpenTabs plugins. Use it when developing a new plugin for a website — it reveals how the site authenticates users, what APIs it calls, what framework it uses, and what data is available in the DOM and storage. The tool orchestrates multiple browser tool capabilities (tab management, network capture, script execution, cookie reading) and passes collected data through six detection modules in `platform/mcp-server/src/browser-tools/analyze-site/`:

- `detect-auth.ts` — detects cookie sessions, JWTs in localStorage/sessionStorage, Bearer/Basic auth headers, API key headers, CSRF tokens, custom auth headers, and auth data in window globals
- `detect-apis.ts` — classifies captured network requests by protocol (REST, GraphQL, gRPC-Web, JSON-RPC, tRPC, WebSocket, SSE, form submissions), groups by endpoint, filters noise, and identifies the primary API base URL
- `detect-framework.ts` — identifies frontend frameworks (React, Next.js, Vue, Nuxt, Angular, Svelte, jQuery, Ember, Backbone) with versions, and detects SPA vs MPA and SSR
- `detect-globals.ts` — scans non-standard window globals and flags those containing auth-related data
- `detect-dom.ts` — detects forms (action, method, fields), interactive elements, and data-\* attribute patterns
- `detect-storage.ts` — lists cookie, localStorage, and sessionStorage key names with auth-relevance flags (values are never read for security)

The tool returns a structured report including a `suggestions` array of concrete plugin tool ideas derived from the detected APIs, forms, and endpoints. Each suggestion includes a `toolName`, `description`, `approach` (with specific endpoint), and `complexity` rating. Input: `{ url: string, waitSeconds?: number }`. The detection modules are pure analysis functions — they receive pre-collected data and return structured results, keeping the analysis testable independently of the browser.

## Plugin Settings

The server resolves plugin settings between discovery Phase 4 (merge) and Phase 5 (buildRegistry). Settings are stored in `config.json` under `settings.<pluginShortName>` and loaded into `ServerState.pluginSettings` on each reload.

**Settings resolution** (`settings-resolver.ts`): `resolvePluginSettings(plugin, pluginSettings)` computes `resolvedSettings` for each plugin. For `url`-type fields, it derives a Chrome match pattern (`*://hostname/*`) from the user-provided URL and populates `homepage` if the plugin has no static homepage. The derived match pattern is merged into `RegisteredPlugin.urlPatterns`, enabling URL-based tool dispatch without hardcoded patterns.

**`ConfigStatePlugin`**: The `configSchema` and `resolvedSettings` fields are included in each plugin's config state payload (built by `buildConfigStatePayload`), sent to the extension via `sync.full` and `plugin.update` messages. The extension stores these on `PluginMeta` and injects `resolvedSettings` into the MAIN world before adapter execution.

**`savePluginSettings`** (`config.ts`): Persists a plugin's settings map to `config.json` using the same read-modify-write pattern as `savePluginPermissions`. After saving, a reload is triggered so URL patterns are re-derived.

**`POST /plugin-settings`**: HTTP endpoint (bearer auth, rate-limited) for CLI use. Accepts `{ plugin, settings }`, validates field values against the plugin's `configSchema` (type checking, required fields, select options), persists via `savePluginSettings`, and broadcasts `plugins.changed`.

**`config.setPluginSettings`**: JSON-RPC method routed in `extension-protocol.ts` for the side panel's `bg:setPluginSettings` relay.

## Pre-Scripts

Plugins can bundle a pre-script IIFE (`dist/pre-script.iife.js`) that runs at `document_start` in MAIN world before any page script. The MCP server threads this through the entire dispatch chain to the extension.

**Loader** (`loader.ts`): When `tools.json` declares `preScriptFile`, the loader reads `dist/pre-script.iife.js` from disk and stores its content as `preScript` on `LoadedPlugin` (and thus `RegisteredPlugin`). `preScriptHash` is read directly from the manifest. Both fields are `undefined` when the plugin has no pre-script.

**Adapter files** (`adapter-files.ts`): `writePreScriptFile(pluginName, preScript)` writes a content-hashed file at `adapters/<plugin>-prescript-<hash8>.js` (distinct from the adapter `adapters/<plugin>-<hash8>.js`). `cleanupStaleAdapterFiles` strips both the hash suffix and the `-prescript` infix when computing the base name for known plugins, so pre-script files for installed plugins are never deleted on re-sync.

**Extension protocol** (`extension-protocol.ts`): Both `sync.full` and `plugin.update` messages include `preScriptFile` and `preScriptHash` as optional fields via conditional spreads. The extension uses `preScriptFile` to register the content script and `preScriptHash` to detect changes that require tab reloads.

**File watcher** (`file-watcher.ts`): In dev mode, `handleToolsJsonChange` re-reads `pre-script.iife.js` from disk and updates `updatedFields.preScript` / `updatedFields.preScriptHash` when `tools.json` changes, ensuring `plugin.update` carries the new hash when a plugin is rebuilt in watch mode.

**Plugin inspect** (`mcp-tool-dispatch.ts`): `plugin_inspect` includes `preScriptSource`, `preScriptLineCount`, and `preScriptByteSize` when the plugin has a pre-script. These fields are omitted entirely when `plugin.preScript` is `undefined`. The `REVIEW_GUIDANCE` constant includes a pre-script section instructing reviewers to scrutinize pre-script code with particular attention given its elevated execution context (MAIN world, before all page scripts, no CSP restrictions).

## MCP Tool Design Guidelines

- **Tool descriptions must be accurate and informative** — descriptions are shown to AI agents, so clarity is critical for proper tool usage
- **Keep parameter descriptions clear** — explain what each parameter does and provide examples where helpful
- **Update descriptions when behavior changes** — if a tool's functionality changes, update its description immediately
- **Design for usefulness** — think about how AI agents and engineers will actually use the tool; make it intuitive and powerful
- **Design for composability** — consider how tools can work together; tools should complement each other to make this MCP server the most powerful toolset for engineers
- **Return actionable data** — tool responses should include IDs, references, and context that enable follow-up actions with other tools
