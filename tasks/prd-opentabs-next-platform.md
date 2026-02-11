# PRD: OpenTabs Next — MCP Server + Browser Extension + Plugin Ecosystem

## Introduction

OpenTabs Next is a ground-up redesign of the OpenTabs platform that formalizes the current architecture into an open plugin ecosystem. The platform enables AI agents (Claude Code, etc.) to interact with web applications through the user's authenticated browser session — "zero tokens, full access." The key shift: instead of hardcoding service integrations into the platform, every web service is a plugin. Official and community plugins are distributed via npm, dynamically loaded at runtime, and hot-reloaded without restarting the MCP server.

The Slack plugin is the first official plugin and serves as the reference implementation. It uses the exact same SDK and plugin lifecycle as any community plugin — no special treatment. The Slack plugin drives SDK refinement and ensures the developer experience is easy, fun, and secure.

### Problem

1. **API limitations**: Many web services don't provide MCP servers, have restrictive APIs, low rate limits, or require expensive enterprise plans for programmatic access. Users already have authenticated browser sessions with full access — OpenTabs leverages those sessions instead.

2. **Ecosystem lock-in**: The current OpenTabs codebase bundles all service integrations into a monolith. Adding a new service requires modifying the core platform, and there's no way for the community to contribute plugins independently.

3. **Distribution friction**: Plugins should be installable with `bun add opentabs-plugin-jira` and automatically discovered — no manual configuration, no rebuilds, no server restarts.

## Goals

- Ship a production-ready plugin SDK (`@opentabs/plugin-sdk`) that third-party developers can use to build, test, and publish plugins
- Ship a plugin loader (`@opentabs/plugin-loader`) that discovers plugins from `node_modules`, config files, and local filesystem paths — and dynamically loads tool modules
- Ship a scaffolding CLI (`create-opentabs-plugin`) so developers can bootstrap a new plugin in seconds
- Ship the MCP server (`@opentabs/mcp-server`) with dynamic plugin loading, hot reload, and health checking
- Ship the Chrome extension (`@opentabs/browser-extension`) with dynamic adapter injection, service controller creation, and plugin lifecycle management
- Ship the Slack plugin (`@opentabs/plugin-slack`) as the first official plugin using the SDK — no special treatment
- Support community plugins via npm with automatic discovery (`opentabs-plugin-*` naming convention or `opentabs-plugin` keyword)
- Enable hot reload of all plugins (official and community) without rebooting the MCP server
- Provide test utilities (`@opentabs/plugin-test-utils`) for plugin authors to test tools in isolation
- **Establish the autonomous development loop first**: before building features, the platform must support fully autonomous AI-agent-driven development with zero human intervention (build → hot reload → extension reload → test via tools)

## Development Philosophy

### Local-First, Zero Package Dependencies Between Platform and Plugins

During development, **nothing is published to npm**. The platform core (`platform/*`) and the Slack plugin (`plugins/slack/`) are developed in separate directories with **no package dependency between them**. The Slack plugin does NOT appear in the platform's `package.json` workspaces or dependencies.

Instead, the MCP server supports **local plugin installation** — loading a plugin directly from a filesystem path. This is the same mechanism used by community developers during local plugin development, so building the Slack plugin exercises the exact same code path.

```
__next__/
├── platform/           # Core platform packages (monorepo workspaces)
│   ├── core/
│   ├── plugin-sdk/
│   ├── plugin-loader/
│   ├── mcp-server/
│   ├── browser-extension/
│   ├── plugin-test-utils/
│   └── create-plugin/
└── plugins/            # Plugin development area (NOT workspace members)
    └── slack/          # Loaded via local path, not package dependency
```

The Slack plugin references `@opentabs/plugin-sdk` as a **peer dependency** during development (resolved from the workspace via Bun's module resolution or a local override). When published to npm, it peer-depends on the published SDK. The platform never `import`s from `@opentabs/plugin-slack` — it discovers it via the plugin loader's local path mechanism.

**Why this matters:**
- Proves the plugin SDK works for external developers (no hidden platform-internal shortcuts)
- The local plugin install path is tested continuously during development
- No circular or implicit dependencies — the platform genuinely treats the Slack plugin as external
- Publishing to npm is a distribution concern, not a development concern

### Slack Plugin as the DX Acceptance Test

All platform SDK, test utilities, CLI scaffolding, and tooling **must be verified against the Slack official plugin**. Any friction discovered while developing the Slack plugin must be resolved in the platform before shipping. The Slack plugin is not just a reference — it is the acceptance test for the developer experience. If building a Slack tool feels clunky, the SDK is wrong, not the plugin author.

### Autonomous Development Loop (Priority Zero)

The very first thing to build and verify is the **self-iteration development loop**. Before any features are implemented, the platform must support a fully autonomous development cycle where an AI agent (Claude Code) can modify code, build, and verify changes with zero human involvement:

```
Edit code → Build → Hot reload (MCP server) → Reload extension (MCP tool) → Test via tools
```

## Current Implementation State

> **Audit date**: 2026-02-10. Type-check passes clean (`bun run type-check`).

### Completed Packages

| Package | Status | Notes |
|---------|--------|-------|
| `@opentabs/core` | **Done** | All shared types: JSON-RPC, messaging, services, plugin manifest, lifecycle hooks, dynamic service registry |
| `@opentabs/plugin-sdk` | **Done** | Three entry points (`.`, `./server`, `./adapter`), `definePlugin()`, `createToolRegistrar()`, `sendServiceRequest()`, `registerAdapter()`, `createScopedFetch()`, permission enforcement, error patterns |
| `@opentabs/plugin-loader` | **Done** | `discoverPlugins()` (automatic + explicit + local), `validatePluginManifest()` (Zod schema), `loadPlugins()` (full pipeline), JSON Schema generation, name conflict + URL overlap detection |
| `@opentabs/plugin-test-utils` | **Done** | `createTestHarness()`, `createMockProvider()` with `.resolveWith()` / `.rejectWith()` |
| `create-opentabs-plugin` | **Done** | CLI + programmatic API, template with variable substitution, name validation |
| `@opentabs/mcp-server` | **Done** | HTTP/stdio transport, WebSocket relay, plugin initialization, hot reload, tool registration pipeline, health endpoint |
| `plugins/slack` | **Done** | Adapter, health check evaluator, 9 tool domains (messages, search, channels, conversations, users, files, pins, stars, reactions), error patterns |
| `browser-extension` | **Done** | Plugin manager, adapter manager, service controllers, offscreen WS, tab lifecycle, plugin sync |
| `platform/schemas/plugin-v1.json` | **Done** | Generated from Zod schema, committed |

### Remaining Work

| Feature | Status | PRD Stories |
|---------|--------|-------------|
| `~/.opentabs/` config system | **Not started** | US-003a through US-003d |
| Tool enable/disable gating | **Not started** | US-005a, US-005b |
| Platform system tools | **Not started** | US-007b-a through US-007b-c |
| Side panel UI | **Stub only** | US-011a through US-011d |
| Tool activity broadcasting | **Not started** | US-012a, US-012b |
| Console logging on invocation | **Not started** | US-013a |
| Outdated plugin check | **Not started** | US-007c |
| npm distribution workflow | **Not started** | US-019a |
| End-to-end verification | **Not started** | US-020a |

## User Stories

### Phase 0: Development Infrastructure

### US-000: Autonomous development loop
**Status:** DONE

**Description:** As an AI development agent (Claude Code), I need to modify code, build, and verify changes with zero human intervention so that development can proceed autonomously.

**Acceptance Criteria:**
- [x] MCP server runs via `bun --hot dist/index.js` and hot-reloads when compiled files change
- [x] `bun run build` from `platform/mcp-server/` compiles TS → JS in `dist/` without deleting `dist/` first (safe for hot reload)
- [x] Hot reload patches tool handlers and WebSocket relay methods on live sessions via `Object.setPrototypeOf`
- [x] Hot reload sends `notifications/tools/list_changed` to all connected MCP clients
- [x] `reload_extension` MCP tool exists and triggers `chrome.runtime.reload()`
- [x] Extension disconnects briefly on reload, then reconnects automatically via the offscreen document's WebSocket
- [x] `GET /health` returns JSON with: `streamSessions`, `extension` status, `hotReload.reloadCount`, `hotReload.lastReload.success`, plugin names/count
- [x] After MCP server hot reload: `curl /health` confirms reload succeeded, calling affected tools verifies runtime behavior
- [x] After extension reload: extension reconnects within a few seconds, adapter scripts re-injected into matching tabs
- [x] Two-domain workflow documented and working
- [x] `bun run type-check` passes

---

### Phase 1: Core Platform

### US-001: Platform core packages
**Status:** DONE

**Description:** As a platform maintainer, I want the core packages (`@opentabs/core`, `@opentabs/plugin-sdk`, `@opentabs/plugin-loader`, `@opentabs/plugin-test-utils`) to be buildable and type-checkable as local workspace packages.

**Acceptance Criteria:**
- [x] `@opentabs/core` exports all shared types (PluginManifest, ServiceDefinition, JSON-RPC, lifecycle hooks, service registry)
- [x] `@opentabs/plugin-sdk` re-exports types from core + provides `definePlugin()`, `createToolRegistrar()`, `sendServiceRequest()`, `registerAdapter()`, `createScopedFetch()`
- [x] `@opentabs/plugin-sdk` has three entry points: `.` (types + definePlugin), `./server` (tool helpers), `./adapter` (adapter helpers)
- [x] `@opentabs/plugin-loader` exports `discoverPlugins()`, `loadPlugins()`, `validatePluginManifest()`, `generateJsonSchema()`
- [x] `@opentabs/plugin-test-utils` exports `createTestHarness()` and `createMockProvider()`
- [x] All packages have correct `exports` map, `types`, and `peerDependencies` in package.json
- [x] Packages are workspace members under `platform/*`
- [x] `bun run build && bun run type-check` passes

---

### US-002: Plugin manifest schema and validation
**Status:** DONE

**Description:** As a plugin author, I want a well-documented JSON manifest format (`opentabs-plugin.json`) with schema validation so I get clear errors when my manifest is invalid.

**Acceptance Criteria:**
- [x] Zod schema validates: name format, semver version, Chrome match patterns, environment↔domain consistency, health check method prefix, network permission coverage
- [x] `$schema` field enables IDE autocompletion (JSON Schema generated from Zod)
- [x] `plugin-v1.json` schema file generated from Zod schema via `bun run generate-schema`, committed to `platform/schemas/`
- [x] Reserved names (`browser`, `system`, `extension`, `plugin`, `opentabs`) are rejected
- [x] Overly broad URL patterns and network permissions are rejected
- [x] Name conflict and URL pattern overlap detection across installed plugins
- [x] Validation errors include field path and actionable message
- [x] `bun run type-check` passes

---

### US-003a: Config directory and file structure
**Description:** As a user, I want `~/.opentabs/` created automatically on first run with a default `config.json` and `plugins.json`, so I have a human-readable place to manage global settings.

**Acceptance Criteria:**
- [ ] `~/.opentabs/` directory created on first MCP server run if it doesn't exist
- [ ] `~/.opentabs/config.json` created with a default structure: `{ "plugins": [], "server": {} }`
- [ ] `~/.opentabs/plugins.json` created with a default structure: `{}` (empty — all tools disabled until explicitly enabled)
- [ ] Both files are valid JSON, human-readable, and hand-editable
- [ ] A `readConfig()` function in a new `platform/mcp-server/src/opentabs-config.ts` module reads both files and returns a typed `OpenTabsUserConfig` object
- [ ] A `writePluginState()` function writes tool enable/disable changes back to `~/.opentabs/plugins.json`
- [ ] File read errors (permissions, corrupt JSON) are caught and logged with actionable messages — the server starts with defaults, not crashes
- [ ] `bun run type-check` passes

### US-003b: MCP server reads config on startup and hot reload
**Description:** As a user, I want the MCP server to read `~/.opentabs/config.json` at startup and on every hot reload, so that config changes take effect without a restart.

**Acceptance Criteria:**
- [ ] `initializePlugins()` in `plugin-init.ts` calls `readConfig()` and uses global plugin paths from `~/.opentabs/config.json` as additional discovery sources
- [ ] `refreshPluginTools()` re-reads `~/.opentabs/config.json` on every hot reload cycle
- [ ] Plugin paths from `~/.opentabs/config.json` are merged with project-level `opentabs.config` (project config takes precedence for plugin paths)
- [ ] Adding a new local plugin path to `~/.opentabs/config.json` and triggering a hot reload picks it up
- [ ] `/health` endpoint reports the config file path and last-read timestamp
- [ ] `bun run type-check` passes

### US-003c: Project-level opentabs.config support
**Description:** As a developer, I want a project-level `opentabs.config.ts` (or `.js`/`.json`) in the working directory for project-specific plugin paths that override global config.

**Acceptance Criteria:**
- [ ] `discoverPlugins()` already supports `opentabs.config` files — this story verifies the merge behavior with `~/.opentabs/config.json`
- [ ] Global config provides the base plugin list; project config adds or overrides plugin paths
- [ ] Tool enable/disable state always comes from `~/.opentabs/plugins.json` (user config takes precedence for security settings)
- [ ] Documented in a brief comment block in the config module
- [ ] `bun run type-check` passes

### US-003d: Side panel reads config from MCP server
**Description:** As a user, I want the side panel to read plugin and tool state from the MCP server (not from `chrome.storage.local`), so settings persist across browsers and are always in sync with the server's truth.

**Acceptance Criteria:**
- [ ] MCP server exposes a WebSocket message type `get_plugin_state` that returns all plugins with per-tool enabled/disabled state from `~/.opentabs/plugins.json`
- [ ] MCP server exposes a WebSocket message type `set_tool_enabled` that toggles a specific tool in `~/.opentabs/plugins.json` and triggers `notifications/tools/list_changed`
- [ ] Side panel sends `get_plugin_state` on connect and renders from the response
- [ ] Side panel sends `set_tool_enabled` when the user toggles a tool — does NOT write to `chrome.storage.local`
- [ ] `bun run type-check` passes

---

### US-004: Plugin discovery — node_modules, config, and local paths
**Status:** DONE

**Description:** As a user, I want plugins discovered from npm installs, config files, and local filesystem paths.

**Acceptance Criteria:**
- [x] Automatic scan of `node_modules` for packages matching `@opentabs/plugin-*` or `opentabs-plugin-*`
- [x] Fallback to `opentabs-plugin` keyword in package.json for non-standard names
- [x] Scoped packages discovered correctly
- [x] Plugin lists read from both config files and project-level `opentabs.config`
- [x] Local plugin paths resolved correctly
- [x] Local plugins get trust tier `local`
- [x] Explicit config entries take precedence over auto-discovered duplicates
- [x] `bun run type-check` passes

---

### US-005a: Tool enable/disable state in plugins.json
**Description:** As a user, I want all tools of a newly installed plugin to start disabled by default, and only appear in the MCP tool list after I explicitly enable them.

**Acceptance Criteria:**
- [ ] When `initializePlugins()` discovers a plugin, it checks `~/.opentabs/plugins.json` for per-tool enabled state
- [ ] If a plugin is not in `plugins.json` (first discovery), all its tools are treated as disabled
- [ ] If a tool is disabled, it is NOT registered on the MCP server — it does not appear in the tool list at all
- [ ] If a tool is enabled (explicitly set to `true` in `plugins.json`), it is registered normally
- [ ] `registerAllTools()` filters plugin tools based on enabled state before calling `server.registerTool()`
- [ ] When a tool's enabled state changes (via side panel → MCP server → `plugins.json`), the next hot reload or `refreshPluginTools()` picks up the change
- [ ] `notifications/tools/list_changed` is sent to MCP clients when tools are enabled/disabled
- [ ] `bun run type-check` passes

### US-005b: Convenience enable/disable in plugins.json
**Description:** As a user who prefers hand-editing config, I want `~/.opentabs/plugins.json` to support both individual tool toggles and a plugin-level shorthand that enables/disables all tools for a plugin.

**Acceptance Criteria:**
- [ ] `plugins.json` format: `{ "slack": { "tools": { "slack_send_message": true, "slack_search": false } } }`
- [ ] Shorthand: `{ "slack": { "allToolsEnabled": true } }` enables all tools for the `slack` plugin (individual overrides still apply)
- [ ] Default (no entry): all tools disabled
- [ ] The `readPluginState()` function resolves the effective enabled state per tool, considering both `allToolsEnabled` and individual overrides
- [ ] `bun run type-check` passes

---

### US-005: Plugin dynamic loading and module resolution
**Status:** DONE

**Description:** As the platform, I need to dynamically import each plugin's tool registration module and adapter IIFE at runtime so plugins work without a platform rebuild.

**Acceptance Criteria:**
- [x] `loadPlugins()` discovers, validates, loads tool modules, and merges into registry
- [x] Tool modules are loaded via dynamic `import()` with cache-busting for hot reload
- [x] `registerTools` export is required; `isHealthy` and lifecycle hooks are optional
- [x] Lifecycle hooks extracted from named exports
- [x] Adapter IIFE read from disk and bundled into install payloads for the extension
- [x] Trust tiers determined: `official` (scoped @opentabs), `community` (npm), `local` (filesystem path)
- [x] Local plugins loaded identically to npm plugins
- [x] Failed plugins don't crash the platform
- [x] `bun run type-check` passes

---

### US-006: Dynamic service registry
**Status:** DONE

**Description:** As the platform, I need a runtime-mutable service registry so plugins can be installed and uninstalled without restarting.

**Acceptance Criteria:**
- [x] `setServiceRegistry()` for initial population, `addServiceDefinitions()` / `removeServiceDefinitions()` for runtime mutations
- [x] Registry change listeners notify the extension of added/removed services
- [x] Derived lookup tables recomputed on mutation
- [x] Name collision throws on `addServiceDefinitions()`
- [x] All lookup helpers work correctly after mutations
- [x] `bun run type-check` passes

---

### US-007: MCP server with plugin initialization and hot reload
**Status:** DONE (partially — outdated check not implemented)

**Description:** As a user running the MCP server, I want plugins discovered and loaded at startup (including from local paths), and I want code changes to take effect without restarting.

**Acceptance Criteria:**
- [x] `initializePlugins()` runs during server startup
- [x] Plugin tool registrations injected into the tool pipeline
- [x] `refreshPluginTools()` for hot reload with cache busting
- [x] Local plugin changes are picked up on hot reload
- [x] `bun --hot` detects compiled output changes
- [x] `/health` endpoint reports plugin status
- [x] Plugin install payloads cached and re-sent to extension on reconnect
- [x] `bun run type-check` passes

---

### US-007b-a: System tool — reload plugins
**Description:** As an AI agent, I need an `opentabs_reload_plugins` MCP tool that re-discovers plugins and re-reads `~/.opentabs/` config without restarting the server.

**Acceptance Criteria:**
- [ ] New tool `opentabs_reload_plugins` in `platform/mcp-server/src/tools/system/reload-plugins.ts`
- [ ] Calls `refreshPluginTools()` and re-reads `~/.opentabs/` config
- [ ] Returns a summary: plugins discovered, tools added/removed, config changes detected
- [ ] Sends `notifications/tools/list_changed` to all connected MCP clients
- [ ] Tool is always available (platform-native, not a plugin tool)
- [ ] `bun run type-check` passes

### US-007b-b: System tool — list plugins and get health
**Description:** As an AI agent, I need `opentabs_list_plugins` and `opentabs_get_health` MCP tools to inspect the platform state without opening a browser.

**Acceptance Criteria:**
- [ ] `opentabs_list_plugins` returns all discovered plugins with: name, version, trust tier, tab state, and per-tool enabled/disabled status (from `~/.opentabs/plugins.json`)
- [ ] `opentabs_get_health` returns the same data as `GET /health`: server state, extension status, plugin status, hot reload count
- [ ] Both tools are platform-native and always available
- [ ] Tools are defined in `platform/mcp-server/src/tools/system/`
- [ ] `bun run type-check` passes

### US-007b-c: System tools — get/set config
**Description:** As an AI agent, I need `opentabs_get_config` and `opentabs_set_config` MCP tools to read and modify non-security server settings.

**Acceptance Criteria:**
- [ ] `opentabs_get_config` returns current non-security config from `~/.opentabs/config.json` (plugin paths, server settings — NOT tool enable/disable state)
- [ ] `opentabs_set_config` updates non-security settings (e.g., add/remove plugin paths, toggle verbose logging)
- [ ] `opentabs_set_config` does NOT allow enabling/disabling tools — that is a security boundary reserved for the side panel
- [ ] Both tools are platform-native
- [ ] Config changes are written atomically (write to temp file, rename)
- [ ] `bun run type-check` passes

---

### US-007c: Outdated plugin check on startup
**Description:** As a user, I want the MCP server to check installed npm plugins for newer versions on startup and tell me what `bun update` command to run.

**Acceptance Criteria:**
- [ ] On startup, the MCP server queries the npm registry for each installed npm plugin's latest version (skip local plugins)
- [ ] The check is non-blocking — server startup does not wait for it
- [ ] Results are logged to CLI stdout with the exact `bun update` command
- [ ] Results are cached in memory and exposed via `/health` endpoint
- [ ] Results are available to the side panel via a WebSocket message type
- [ ] `bun run type-check` passes

---

### US-008: Plugin-SDK request provider and permission enforcement
**Status:** DONE

**Description:** As a plugin author, I want `sendServiceRequest()` and `sendBrowserRequest()` to just work in my tool handlers, with the platform enforcing my declared permissions.

**Acceptance Criteria:**
- [x] `sendServiceRequest(service, params, action?)` routes through the WebSocket relay
- [x] `sendBrowserRequest(action, params?)` routes to chrome.tabs/windows APIs
- [x] `sendBrowserRequest()` rejected at runtime if plugin doesn't declare `nativeApis: ['browser']`
- [x] `AsyncLocalStorage` tracks current tool ID
- [x] `createToolRegistrar(server)` provides `{ tools, define }`
- [x] `success(data)` and `error(err)` format tool results per MCP protocol
- [x] Extensible error pattern registry
- [x] `bun run type-check` passes

---

### US-009: Adapter SDK and MAIN world injection
**Status:** DONE

**Description:** As a plugin author, I want simple primitives to write adapter code that runs in the web page's JavaScript context.

**Acceptance Criteria:**
- [x] `registerAdapter(name, handleRequest)` registers on `window.__openTabs.adapters`
- [x] `ok(id, data)` and `fail(id, code, message)` for JSON-RPC response construction
- [x] `parseAction(method)` extracts the action from method strings
- [x] `createScopedFetch(allowedDomains, pluginName)` for opt-in domain restriction
- [x] Error code constants exported
- [x] Adapters built into self-contained IIFEs
- [x] `bun run type-check` passes

---

### US-010: Browser extension dynamic plugin management
**Status:** DONE

**Description:** As the browser extension, I need to dynamically install/uninstall plugins at runtime.

**Acceptance Criteria:**
- [x] `plugin-manager.ts` receives install payloads from MCP server, stores in `chrome.storage.local`
- [x] `adapter-manager.ts` dynamically registers/unregisters content scripts
- [x] `webapp-service-controller.ts` is data-driven — one generic controller per plugin service
- [x] Service controllers created/destroyed when plugins are installed/uninstalled
- [x] Health checks run using the plugin's configured method
- [x] Extension reconnects to MCP server and re-receives plugin payloads
- [x] `bun run type-check` passes

---

### US-011a: Side panel — plugin list and tool toggles (basic)
**Description:** As a user, I want the side panel to show all installed plugins with their tools, so I can see what's available.

**Acceptance Criteria:**
- [ ] Side panel is a React app (matching the existing `pages/side-panel/` pattern from the main codebase)
- [ ] On open, side panel sends `get_plugin_state` to MCP server via the background script
- [ ] Renders a list of plugins grouped by name, showing: display name, version, trust tier badge (official/community/local)
- [ ] Under each plugin, renders a list of tools with their names and descriptions
- [ ] If MCP server is disconnected, shows a "Not connected" state
- [ ] `bun run type-check` passes
- [ ] Verify in browser

### US-011b: Side panel — tool enable/disable toggles
**Description:** As a user, I want to toggle individual tools on/off from the side panel, with changes taking effect immediately.

**Acceptance Criteria:**
- [ ] Each tool has a toggle switch (enabled/disabled)
- [ ] Each plugin group has a top-level "enable all / disable all" toggle
- [ ] Toggling sends `set_tool_enabled` to MCP server → writes to `~/.opentabs/plugins.json` → triggers `notifications/tools/list_changed`
- [ ] Toggle state updates in the UI immediately (optimistic update)
- [ ] Newly installed plugin tools are shown as disabled by default
- [ ] `bun run type-check` passes
- [ ] Verify in browser

### US-011c: Side panel — tab state indicators
**Description:** As a user, I want the side panel to show tab state per plugin (`closed`, `not-authed`, `authed`) so I know if I need to open or log in to a tab.

**Acceptance Criteria:**
- [ ] Each plugin displays a status indicator: green (authed), yellow (not-authed), red (closed)
- [ ] `closed` state shows a hint: "Open <url> in your browser"
- [ ] `not-authed` state shows a hint: "Log in to <service>"
- [ ] `authed` state shows no hint (clean, good state)
- [ ] Tab state updates are received from the background script and reflected in real time
- [ ] `bun run type-check` passes
- [ ] Verify in browser

### US-011d: Side panel — outdated plugin notifications
**Description:** As a user, I want the side panel to show when a plugin has an available update on npm.

**Acceptance Criteria:**
- [ ] Side panel receives outdated plugin data from the MCP server (populated on startup check from US-007c)
- [ ] Outdated plugins show a badge with the available version and the `bun update` command to run
- [ ] Notifications are non-intrusive (small indicator, not a blocking dialog)
- [ ] `bun run type-check` passes
- [ ] Verify in browser

---

### US-012a: Tool activity events — MCP server broadcasting
**Description:** As the platform, I need the MCP server to broadcast `tool_invocation_start` and `tool_invocation_end` events to the extension so the side panel can show real-time activity.

**Acceptance Criteria:**
- [ ] When a tool handler begins execution, the MCP server emits `{ type: "tool_invocation_start", plugin, tool, ts }` over the WebSocket to the extension
- [ ] When a tool handler completes, it emits `{ type: "tool_invocation_end", plugin, tool, duration_ms, success }`
- [ ] Events are fire-and-forget — the server does not wait for acknowledgement
- [ ] Events are emitted for both platform-native tools and plugin tools
- [ ] The event emission is injected at the tool registration wrapper level (not by plugin code)
- [ ] `bun run type-check` passes

### US-012b: Tool activity — side panel animation
**Description:** As a user, I want the side panel to animate the corresponding plugin/tool entry when a tool is being invoked.

**Acceptance Criteria:**
- [ ] Side panel receives `tool_invocation_start` and `tool_invocation_end` events from the background script
- [ ] Active tools show a visual indicator (e.g., spinner, pulse animation)
- [ ] The indicator clears when `tool_invocation_end` is received
- [ ] Activity is transient — no persistent log
- [ ] `bun run type-check` passes
- [ ] Verify in browser

---

### US-013a: Console logging on tool invocation
**Description:** As a developer, I want every plugin tool invocation to log a `console.warn` in the target web page's DevTools console with a link to the source package.

**Acceptance Criteria:**
- [ ] When the adapter receives a JSON-RPC request, it logs `console.warn` in the target tab: `[OpenTabs] <plugin>.<tool> invoked — <link>`
- [ ] Link is the npm page URL for published plugins, or the local filesystem path for local plugins
- [ ] The log is `console.warn` (not `console.log`) so it stands out without being filtered
- [ ] Logging is injected at the adapter dispatch level in the extension's `adapter-manager.ts` — plugin authors do NOT need to add it
- [ ] The warning is minimal (one line + link) — does not log request params or response data
- [ ] `bun run type-check` passes

---

### Phase 2: Developer Tooling

### US-014: Plugin scaffolding CLI
**Status:** DONE

**Description:** As a plugin developer, I want to run `bunx create-opentabs-plugin jira --domain .atlassian.net` and get a ready-to-build plugin project.

**Acceptance Criteria:**
- [x] CLI accepts: plugin name (required), `--domain`, `--display`, `--description`, `--author`, `--output`
- [x] Template includes: `opentabs-plugin.json`, `package.json`, `tsconfig.json`, `src/adapter.ts`, `src/tools/index.ts`, `src/tools/general.ts`
- [x] Template variables replaced in all files
- [x] Plugin name validation: lowercase alphanumeric + hyphens, not reserved
- [x] Programmatic API: `scaffoldPlugin(options)`
- [x] `bun run type-check` passes

---

### US-015: Plugin test utilities
**Status:** DONE

**Description:** As a plugin author, I want to unit-test my tool handlers without a running MCP server or browser.

**Acceptance Criteria:**
- [x] `createTestHarness()` provides: `registerTools()`, `callTool(name, params)`, `toolNames`, `getTool()`, `assertToolRegistered()`
- [x] `createMockProvider()` provides: `install()`, `uninstall()`, `onServiceRequest()` with `.resolveWith()` / `.rejectWith()`
- [x] `callTool()` returns `ParsedToolResult` with `.isError`, `.text`, `.data`, `.json<T>()`
- [x] `withToolId` context preserved
- [x] `bun run type-check` passes

---

### Phase 3: Reference Plugin

### US-016: Slack plugin as reference implementation
**Status:** DONE

**Description:** As a plugin author, I want a complete, production-quality Slack plugin that demonstrates every SDK feature.

**Acceptance Criteria:**
- [x] Uses `@opentabs/plugin-sdk` as a peer dependency — no platform-internal imports
- [x] No package dependency between platform and Slack plugin
- [x] `opentabs-plugin.json` manifest covers: adapter config, service config with health check, tool categories, permissions
- [x] Adapter implements `api` action, health check via `auth.test`
- [x] Custom `isHealthy` evaluator
- [x] Error patterns registered for common Slack API errors
- [x] Tools organized by domain: messages, search, channels, conversations, users, files, pins, stars, reactions
- [x] `bun run build && bun run type-check` passes

---

### US-017: Plugin lifecycle hooks
**Status:** DONE

**Description:** As a plugin author, I want to run setup/teardown logic when my plugin is installed, upgraded, or uninstalled.

**Acceptance Criteria:**
- [x] Hooks exported from tools entry module: `onInstall`, `onUninstall`
- [x] `onInstall` receives `reason` ('install' | 'upgrade') and optional `previousVersion`
- [x] All hooks receive base context: `pluginName`, `pluginVersion`, `packagePath`
- [x] Hook failures are caught and logged — never crash the platform
- [x] Hooks run in the MCP server process with access to `sendServiceRequest` / `sendBrowserRequest`
- [x] `bun run type-check` passes

---

### US-018: Plugin permissions and security
**Status:** DONE (partially — tool disable-by-default depends on US-005a)

**Description:** As a user, I want plugins sandboxed so they can only access what they declare, with clear trust indicators.

**Acceptance Criteria:**
- [x] `permissions.network` declares allowed domains; `createScopedFetch()` provides opt-in enforcement
- [x] `permissions.nativeApis` gates access to `sendBrowserRequest()`; missing permission = runtime rejection
- [x] Trust tiers: official = `@opentabs/` scope, community = npm, local = filesystem
- [x] Plugin name reserved list prevents impersonation
- [x] URL pattern overlap detection warns about conflicts
- [x] Manifest validation rejects overly broad patterns
- [ ] **All tools disabled by default on install** (depends on US-005a)
- [x] `bun run type-check` passes

---

### Phase 4: Distribution & Verification

### US-019a: npm distribution readiness
**Description:** As a plugin author, I want to verify that the package.json structure for both official and community plugins is correct for npm publishing.

**Acceptance Criteria:**
- [ ] Slack plugin's `package.json` includes `opentabs-plugin.json` in `files` array
- [ ] Slack plugin's `package.json` `keywords` includes `opentabs-plugin`
- [ ] Slack plugin peer-depends on `@opentabs/plugin-sdk`, `@modelcontextprotocol/sdk`, `zod`
- [ ] Scaffolded plugins (from `create-opentabs-plugin`) also have correct `files`, `keywords`, and `peerDependencies`
- [ ] After `bun add <plugin-package>`, restarting the MCP server auto-discovers it
- [ ] `bun run type-check` passes

---

### US-020a: End-to-end plugin flow verification
**Description:** As a platform developer, I want to verify the full lifecycle: scaffold → develop → build → install → discover → load → enable tools → use tools → hot reload → disable tools → uninstall.

**Acceptance Criteria:**
- [ ] Scaffold a test plugin with `create-opentabs-plugin`
- [ ] Build the plugin: `bun run build`
- [ ] Install locally via config path
- [ ] MCP server discovers the plugin at startup — all tools are disabled by default
- [ ] Enable a tool from side panel → tool appears in MCP client tool list
- [ ] Tool invocation works end-to-end (MCP client → server → extension → adapter → web API)
- [ ] Tool invocation logs a `console.warn` in the target tab
- [ ] Side panel animates during tool invocation
- [ ] Disable tool from side panel → tool removed from MCP client tool list
- [ ] Code change in plugin → rebuild → hot reload picks up changes
- [ ] Uninstall plugin → tools removed
- [ ] Side panel shows outdated notification if newer version exists
- [ ] `bun run build && bun run type-check` passes

---

## Functional Requirements

- FR-1: The plugin SDK must provide type-safe manifest definition (`definePlugin()`), tool registration (`createToolRegistrar()`), adapter registration (`registerAdapter()`), and request routing (`sendServiceRequest()`, `sendBrowserRequest()`) — all without importing platform internals
- FR-2: The plugin loader must discover plugins from three sources: automatic (node_modules naming convention + keyword), explicit (config file), and **local filesystem paths** — with explicit taking precedence for deduplication
- FR-3: The manifest schema must validate structural constraints (Zod) and cross-field consistency (environment↔domain, health check prefix, network coverage) with path-aware error messages
- FR-4: The MCP server must initialize plugins at startup, wire the request provider, register nativeApi permissions, and inject tool registrations into the tool pipeline
- FR-5: The MCP server must hot-reload plugin tools when compiled output changes (`bun --hot`), re-importing modules with cache-busting timestamps, without disconnecting MCP clients
- FR-6: The browser extension must dynamically install/uninstall plugins at runtime: store manifests and adapter code in `chrome.storage.local`, register/unregister content scripts, create/destroy service controllers
- FR-7: The service registry must support runtime mutations (`addServiceDefinitions` / `removeServiceDefinitions`) with change listeners for reactive extension behavior
- FR-8: Plugin trust tiers must be determined by source: `@opentabs/plugin-*` = official, npm packages with keyword = community, **local filesystem paths = local**
- FR-9: The scaffolding CLI must generate a complete, buildable plugin project from a template with variable substitution
- FR-10: Plugin lifecycle hooks must be invoked at the correct lifecycle transitions (install, upgrade, uninstall) with appropriate context
- FR-11: Plugin permissions must be enforced at runtime: `sendBrowserRequest()` gated by `nativeApis` declaration; network domains declared for transparency; overly broad patterns rejected at validation time
- FR-12: The health check system must use plugin-declared methods, params, and evaluators — with the default evaluator as fallback
- FR-13: Plugin install payloads must be cached by the MCP server and re-sent to the extension on reconnect
- FR-14: The Slack plugin must use the identical SDK API as community plugins — no backdoors, no special imports
- FR-15: The autonomous development loop must be the first capability verified
- FR-16: Local plugin loading must be a first-class feature
- FR-17: **All settings must live in `~/.opentabs/`** on the MCP server's filesystem. The side panel is a display/control surface only.
- FR-18: The MCP server must expose an API for the side panel to: read plugin/tool lists with per-tool enabled/disabled state, toggle individual tools enabled/disabled
- FR-19: The MCP server must broadcast **tool activity events** to the extension via WebSocket
- FR-20: Every plugin tool invocation must emit a **`console.warn`** in the target browser tab
- FR-21: **All tools of a newly installed plugin must be disabled by default.** Users must explicitly enable each tool.
- FR-22: The MCP server must check installed npm plugins for available updates on startup
- FR-23: The `@opentabs/` npm scope is the trust indicator for official plugins
- FR-24: The Chrome extension must request `unlimitedStorage` permission
- FR-25: The extension must report **tab state** per service: `closed`, `not-authed`, `authed`
- FR-26: Tool invocations must return **actionable error messages** based on tab state
- FR-27: The `console.warn` must include a clickable link (npm URL or local path)
- FR-28: The side panel must group tools by plugin with a **top-level toggle** per plugin
- FR-29: The outdated check runs **only on startup** (non-blocking)
- FR-30: The MCP server must provide **platform-native system tools** (`opentabs_reload_plugins`, `opentabs_reload_extension`, `opentabs_get_config`, `opentabs_set_config`, `opentabs_list_plugins`, `opentabs_get_health`)
- FR-31: System tools must NOT allow enabling/disabling individual plugin tools — that is a security boundary reserved for the side panel

## Non-Goals

- **Hosted plugin registry**: No proprietary plugin server. All distribution is via npm.
- **Plugin sandboxing via V8 isolates**: Adapters run in the page's MAIN world. Security is via Chrome's content script URL matching.
- **Plugin settings pages**: No per-plugin settings UI. The side panel lists tools with enable/disable toggles.
- **Cross-plugin communication**: Plugins are isolated from each other.
- **Backward compatibility with current OpenTabs**: The `__next__/` directory is a clean redesign.
- **Mobile or non-Chrome browser support**: Chrome (and Chromium-based browsers) only.
- **Plugin versioning constraints**: Conflicts detected by name collision and URL pattern overlap, not version resolution.
- **npm publishing during development**: Everything is local. npm publishing is a production milestone.
- **Extension-side settings storage**: The side panel does NOT own any settings. `~/.opentabs/` is the sole authority.
- **Plugin-level disable**: Only tool-level enable/disable.
- **Plugin dependency conflict detection**: Bun's module resolution handles it.

## Design Considerations

### Package Architecture

```
__next__/
├── platform/                           # Monorepo workspace (bun workspaces)
│   ├── core/                           # @opentabs/core — shared types, no runtime deps
│   ├── plugin-sdk/                     # @opentabs/plugin-sdk — public SDK for plugin authors
│   │   ├── .                           #   Types + definePlugin()
│   │   ├── ./server                    #   Tool helpers (sendServiceRequest, createToolRegistrar)
│   │   └── ./adapter                   #   Adapter helpers (registerAdapter, ok, fail)
│   ├── plugin-loader/                  # @opentabs/plugin-loader — discovery, validation, loading
│   ├── plugin-test-utils/              # @opentabs/plugin-test-utils — test harness + mocks
│   ├── mcp-server/                     # @opentabs/mcp-server — MCP server process
│   ├── browser-extension/              # Chrome extension
│   └── create-plugin/                  # create-opentabs-plugin — scaffolding CLI
│
└── plugins/                            # NOT workspace members — loaded via local path
    └── slack/                          # @opentabs/plugin-slack — reference plugin
```

### Security Model: Tools Disabled by Default

The primary security boundary is **tool-level opt-in**. When a plugin is installed, all of its tools start disabled. The user must explicitly enable each tool via the side panel.

### Settings Architecture

```
~/.opentabs/
├── config.json          # Global config: plugin paths, server settings
└── plugins.json         # Runtime state: per-tool enabled/disabled

opentabs.config.ts       # Project-level: plugin paths (merged with ~/.opentabs/)
```

The MCP server is the single source of truth for all settings. The side panel reads state from the server and sends mutations back to it.

### Development Workflow (Priority Zero)

```
┌─────────────────────────────────────────────────────────┐
│  AI Agent (Claude Code) Development Cycle               │
│                                                         │
│  1. Edit source in platform/* or plugins/*              │
│  2. Build:                                              │
│     - MCP server: bun run build (from platform/mcp-server/)  │
│       → bun --hot detects changes → auto hot reload     │
│     - Extension: bun run build:extension (from root)    │
│       → call reload_extension MCP tool                  │
│     - Plugin: bun run build (from plugins/slack/)       │
│       → rebuild MCP server → auto hot reload            │
│  3. Verify: curl /health, call affected tools           │
│  4. Repeat — zero human involvement                     │
└─────────────────────────────────────────────────────────┘
```

### Hot Reload Architecture

The MCP server runs via `bun --hot`, which re-evaluates modules when compiled output changes. The hot reload system:
1. Re-reads `~/.opentabs/` config
2. Re-discovers plugins
3. Re-imports tool modules with cache-busting query params
4. Diffs old vs new tool definitions
5. Patches existing MCP client sessions in-place
6. Sends `notifications/tools/list_changed` to clients
7. Rebuilds and re-sends plugin install payloads to the extension

### Tool Activity Broadcasting

```json
{ "type": "tool_invocation_start", "plugin": "slack", "tool": "slack_send_message", "ts": 1707580800000 }
{ "type": "tool_invocation_end", "plugin": "slack", "tool": "slack_send_message", "duration_ms": 450, "success": true }
```

### Tab State Model

| State | Meaning | Side Panel | Tool Response |
|-------|---------|------------|---------------|
| `closed` | No browser tab matching the plugin's URL patterns | Error indicator | `"Open app.slack.com in your browser to use this tool"` |
| `not-authed` | Tab open, adapter injected, but health check failed | Warning indicator | `"You are not logged in to Slack — please sign in"` |
| `authed` | Tab open, adapter injected, health check passed | Good indicator | Tool executes normally |

### Console Logging

```
[OpenTabs] slack.send_message invoked — https://npmjs.com/package/@opentabs/plugin-slack
[OpenTabs] my-plugin.do_thing invoked — /Users/dev/my-plugin
```

## Technical Considerations

- **Runtime**: Bun (monorepo with workspaces for platform packages only). MCP server runs under `bun --hot`.
- **Build**: `tsc --build` for composite project references.
- **Module format**: ES Modules (`"type": "module"`) throughout. Adapters compiled to IIFEs.
- **Chrome Extension**: Manifest V3. Offscreen document maintains persistent WebSocket.
- **MCP Protocol**: `@modelcontextprotocol/sdk` v1.12+. Streamable HTTP transport for MCP clients, WebSocket for Chrome extension.
- **Schema validation**: Zod for manifest validation. JSON Schema generated for IDE support.
- **Plugin tool modules**: Must export `registerTools(server) => Map<string, RegisteredTool>`.
- **Adapter build**: Plugin adapters are IIFE-bundled at plugin build time.
- **Local plugin resolution**: Config entries starting with `./` or `../` or absolute paths are local.
- **Settings storage**: `~/.opentabs/config.json` (global) and `~/.opentabs/plugins.json` (per-tool enable/disable). Both JSON, human-readable.
- **Outdated check**: On startup only, non-blocking.
- **Tab state**: Three states: `closed`, `not-authed`, `authed`. The term "connected" is never used.

## Success Metrics

- **Autonomous development**: Full edit → build → verify cycle in under 30 seconds with zero human intervention
- Plugin developer: `bunx create-opentabs-plugin` to working tool in under 30 minutes
- Slack plugin uses zero platform-internal imports
- Hot reload latency: under 3 seconds
- Plugin install: `bun add opentabs-plugin-x` + restart = tools available
- Local plugin install: add path to config + restart = tools available
- Zero regressions in Slack functionality
- Settings changes take effect within 1 second
- Tool activity appears in side panel within 100ms

## Open Questions

None at this time. All design decisions have been resolved.
