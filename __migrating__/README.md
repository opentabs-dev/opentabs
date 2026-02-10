# OpenTabs Platform Migration

This directory contains the refactored OpenTabs codebase, restructured from a monolithic architecture into a **plugin-based platform**. The migration separates the platform infrastructure (MCP server, Chrome extension, plugin SDK) from service-specific integrations (Slack, Datadog, etc.), which become independently installable plugins.

## Why This Migration?

The original codebase has every service hardcoded into the monorepo: adapters in `chrome-extension/src/adapters/`, tools in `packages/mcp-server/src/tools/`, configs in `service-configs.ts`, registry entries in `registry.ts`, and UI definitions in `Options.tsx`. Adding a new service requires touching 5+ files across 3+ packages — all inside the main repo.

The new architecture makes OpenTabs a **platform** where:

- Services are **plugins** — npm packages with a standardized manifest
- The platform provides the **infrastructure** (transport, routing, tab lifecycle, hot reload)
- Community developers can create and distribute plugins without forking the repo
- Enterprise teams can build private plugins for internal tools
- The Chrome extension becomes a **generic adapter runtime** — no service-specific code

## Directory Structure

```
__migrating__/
├── platform/                          # The OpenTabs platform
│   ├── core/                          # @opentabs/core
│   │   └── src/
│   │       ├── index.ts               # Barrel export
│   │       ├── json-rpc.ts            # JSON-RPC 2.0 types and utilities
│   │       ├── messaging.ts           # Chrome extension internal messaging
│   │       ├── services.ts            # Dynamic service registry
│   │       └── plugin-manifest.ts     # Plugin contract types
│   │
│   ├── plugin-sdk/                    # @opentabs/plugin-sdk
│   │   └── src/
│   │       ├── index.ts               # Types + definePlugin() helper
│   │       ├── adapter.ts             # MAIN world adapter utilities
│   │       └── server.ts              # MCP tool registration + permission enforcement
│   │
│   ├── plugin-loader/                 # @opentabs/plugin-loader
│   │   └── src/
│   │       ├── index.ts               # Barrel export
│   │       ├── discover.ts            # Scan node_modules for plugins
│   │       ├── manifest-schema.ts     # Zod-based manifest validation
│   │       └── merge.ts              # Merge plugins into platform registry
│   │
│   ├── mcp-server/                    # @opentabs/mcp-server
│   │   └── src/
│   │       ├── plugin-init.ts         # Plugin system initialization + permission wiring
│   │       └── tools/
│   │           ├── index.ts           # Plugin-aware tool registration
│   │           ├── browser/tabs.ts    # Platform-native: browser tab tools
│   │           ├── extension/reload.ts # Platform-native: extension reload
│   │           └── capture/index.ts   # Platform-native: AI-assisted plugin creation
│   │
│   ├── create-plugin/                 # create-opentabs-plugin (CLI scaffolder)
│   │   ├── src/
│   │   │   └── index.ts              # Scaffolding logic + CLI entry point
│   │   └── template/                  # Plugin template files
│   │       ├── opentabs-plugin.json   # Template manifest
│   │       ├── package.json           # Template package.json
│   │       ├── tsconfig.json          # Template tsconfig (type checking)
│   │       ├── tsconfig.build.json    # Template tsconfig (build output)
│   │       ├── README.md              # Template README with full guide
│   │       └── src/
│   │           ├── adapter.ts         # Template adapter with auth patterns
│   │           └── tools/
│   │               ├── index.ts       # Template tool entry point
│   │               └── general.ts     # Template tool definitions
│   │
│   └── browser-extension/             # @opentabs/browser-extension
│       └── src/
│           ├── capture-content-script.ts  # Relay: MAIN world → background for captured requests
│           └── background/
│               └── capture-handler.ts     # Capture session management + interceptor injection
│
└── plugins/                           # Plugin implementations
    └── slack/                         # @opentabs/plugin-slack
        ├── opentabs-plugin.json       # Plugin manifest
        └── src/
            ├── adapter.ts             # MAIN world adapter
            └── tools/
                ├── index.ts           # Tool entry + isHealthy evaluator
                ├── messages.ts        # Message tools
                ├── search.ts          # Search tools
                └── types.ts           # Slack API response types
```

## Package Dependency Graph

```
@opentabs/core                    ← Zero dependencies. Foundation types.
    ↑
@opentabs/plugin-sdk              ← Depends on core. Public SDK for plugin authors.
    ↑
@opentabs/plugin-loader           ← Depends on core. Discovery & Zod-based validation.
    ↑
@opentabs/mcp-server              ← Depends on core + plugin-sdk + plugin-loader.
@opentabs/browser-extension       ← Depends on core + plugin-loader.
create-opentabs-plugin            ← Zero OpenTabs deps. Standalone CLI scaffolder.

@opentabs/plugin-slack            ← Peer depends on plugin-sdk. Standalone plugin.
```

## Package Descriptions

### `@opentabs/core`

The foundation — zero dependencies on other OpenTabs packages. Contains:

- **JSON-RPC types**: `JsonRpcRequest`, `JsonRpcResponse`, error codes, factory functions, type guards
- **Messaging**: `MessageTypes`, `Defaults`, typed message definitions for Chrome extension communication
- **Services**: `ServiceDefinition`, dynamic service registry (`getServiceRegistry()`, `setServiceRegistry()`)
- **Plugin manifest**: `PluginManifest` type, `ResolvedPlugin`, `ToolRegistrationFn`, reserved names

The service registry is **dynamic** — it starts empty and is populated at startup by merging built-in definitions with plugin definitions. All derived constants (service IDs, domains, URL patterns, timeouts) are recomputed automatically when the registry is set.

### `@opentabs/plugin-sdk`

The public SDK that plugin authors install as a dependency. Two sub-entry points:

**`@opentabs/plugin-sdk/adapter`** — For MAIN world adapter code:
- `registerAdapter(name, handleRequest)` — Register the adapter on the page
- `ok(id, result)`, `fail(id, code, message)` — JSON-RPC response helpers
- `parseAction(method)` — Extract action from `service.action` method strings
- `createScopedFetch(domains, name)` — Domain-restricted fetch for security
- Error code constants: `INVALID_PARAMS`, `METHOD_NOT_FOUND`, `INTERNAL_ERROR`

**`@opentabs/plugin-sdk/server`** — For MCP tool code:
- `createToolRegistrar(server)` — Curried tool registration with auto-wrapping
- `sendServiceRequest(service, params)` — Send requests to the browser adapter
- `sendBrowserRequest(action, params)` — Call chrome.tabs/windows APIs
- `success(data)`, `error(err)` — Format tool results
- `formatError(err)` — Pattern-based error message formatting

**`@opentabs/plugin-sdk`** (main entry) — Types and helpers:
- `definePlugin(manifest)` — TypeScript-checked manifest definition
- Re-exports of `PluginManifest`, `JsonRpcRequest`, `ServiceDefinition`, etc.

**Key design: Request Provider Pattern**

Plugin tools call `sendServiceRequest()` but don't import the WebSocket relay directly. Instead, the MCP server registers a request provider at startup via `__setRequestProvider()`. This decouples plugins from the server's internals, making testing trivial (inject a mock provider) and the transport layer swappable.

### `@opentabs/plugin-loader`

The bridge between npm packages and the platform runtime. Consumed by the MCP server at startup and the browser extension at build time.

**Discovery** (`discover.ts`):
- Scans `node_modules` for packages matching `@opentabs/plugin-*` or `opentabs-plugin-*`
- Also checks for the `opentabs-plugin` keyword in package.json
- Supports explicit configuration via `opentabs.config.ts` / `opentabs.config.json`
- Supports local plugins via relative paths (`./my-plugin`)
- Determines trust tier: official, verified, community, or local

**Validation** (`manifest-schema.ts`):
- Zod-based declarative schema for `opentabs-plugin.json`
- Checks name patterns, version format, URL patterns, domain consistency
- Cross-field validation (health check method prefix, domain/permission alignment)
- Name conflict detection across plugins
- Rejects overly broad URL patterns (`*://*/*`) and reserved names
- Can generate JSON Schema (via `zod-to-json-schema`) for IDE support

**Merge** (`merge.ts`):
- Converts `PluginManifest` → `ServiceDefinition` for the service registry
- Converts `PluginManifest` → `WebappServiceConfig` for service controllers
- Dynamically imports plugin tool modules (`registerTools` + `isHealthy`)
- Health check evaluators come from plugin `isHealthy` exports (no hardcoded evaluators)
- `loadPlugins()` — the primary entry point that runs the full pipeline
- Supports `skipRegistryMerge` option for hot-reload scenarios

### `@opentabs/mcp-server`

The MCP server, refactored to be plugin-aware. Contains only:

- **Platform infrastructure**: HTTP server, WebSocket relay, hot reload, config
- **Platform-native tools**: Browser tab tools, extension reload tool, capture/scaffold tools
- **Plugin initialization** (`plugin-init.ts`): Wires the plugin-loader into the server startup, registers runtime permissions

Service-specific tools (Slack, Datadog, etc.) are **gone from this package** — they live in plugins. The `tools/index.ts` has a `setPluginRegistrations()` function that the plugin initializer calls to inject discovered plugin tools into the registration pipeline.

### `@opentabs/browser-extension`

The Chrome extension, refactored to be a generic adapter runtime. Contains:

- **Background script**: MCP router, adapter manager, service controllers, offscreen manager
- **No service-specific code**: All adapters come from plugins

The adapter manager uses the plugin-loader to discover plugin adapters and register them as MAIN world content scripts. Service controller configs are built from plugin manifests.

### `create-opentabs-plugin`

CLI tool and programmatic API for scaffolding new OpenTabs plugins from the official template. Zero OpenTabs package dependencies — it's a standalone scaffolder that copies template files and replaces `{{variable}}` placeholders.

**Template includes**: `opentabs-plugin.json` manifest, adapter with auth extraction patterns, tool entry point with `isHealthy` boilerplate, example tool definitions, package.json with correct peer dependencies, tsconfig, and a comprehensive README covering all adapter patterns (cookie-based, localStorage, CSRF, JS globals).

**Usage**:
- CLI: `bunx create-opentabs-plugin jira --domain .atlassian.net`
- Programmatic: `import { scaffoldPlugin } from 'create-opentabs-plugin'`
- From AI agent: via `capture_scaffold_plugin` MCP tool

### `@opentabs/plugin-slack`

The first plugin — Slack extracted from the monolith. Demonstrates the complete plugin pattern:

**Manifest** (`opentabs-plugin.json`):
- Declares domains, URL patterns, host permissions
- Configures health check with the `slack-api-ok-field` evaluator
- Defines tool categories for the options page UI
- Declares network permissions scoped to `*.slack.com`

**Adapter** (`src/adapter.ts`):
- Imports only from `@opentabs/plugin-sdk/adapter`
- Extracts auth from `localStorage` (Slack's `localConfig_v2`)
- Supports two transport methods: Web API (`/api/{method}`) and Edge API
- Registers via `registerAdapter('slack', handleRequest)`

**Tools** (`src/tools/`):
- Imports only from `@opentabs/plugin-sdk/server`
- Uses `createToolRegistrar(server)` for clean registration
- Uses `sendServiceRequest('slack', ...)` to communicate with the adapter
- Exports `isHealthy` for custom health check evaluation

## Plugin Manifest: `opentabs-plugin.json`

Every plugin ships this file in its package root. It's the single declarative contract between a plugin and the platform:

```json
{
  "name": "my-service",
  "displayName": "My Service",
  "version": "1.0.0",
  "description": "What this plugin does",
  "adapter": {
    "entry": "./dist/adapter.js",
    "domains": { "production": "app.example.com" },
    "urlPatterns": { "production": ["*://app.example.com/*"] }
  },
  "service": {
    "timeout": 30000,
    "environments": ["production"],
    "authErrorPatterns": ["401", "Unauthorized"],
    "healthCheck": {
      "method": "my-service.api",
      "params": { "endpoint": "/api/health", "method": "GET" }
    }
  },
  "tools": {
    "entry": "./dist/tools/index.js"
  },
  "permissions": {
    "network": ["*.example.com"]
  }
}
```

## Security Model

Security is layered. No single mechanism is a complete boundary — the layers reinforce each other.

### Domain Isolation (Chrome-Enforced)

Plugin adapters are ONLY injected into URLs matching their declared `urlPatterns`. Chrome enforces this at the content script registration level — a Slack plugin physically cannot execute on a Jira page. This is the strongest isolation boundary and is enforced by the browser, not by OpenTabs code.

**URL pattern overlap detection**: The plugin-loader checks all loaded plugins for overlapping URL patterns (via `checkUrlPatternOverlaps`). If two plugins could match the same page, a warning is logged because both adapters would register on `window.__openTabs.adapters` and the second would overwrite the first.

### Manifest Validation (Build-Time)

The plugin-loader validates every manifest at build time (via Zod schema):
- URL patterns must be scoped to specific domains (no `*://*/*`)
- Network permissions must cover declared adapter domains
- Plugin names must not collide with reserved platform names
- Health check methods must be prefixed with the plugin name
- URL patterns are checked for cross-plugin overlaps (warnings)

### Request Provider Scoping (Server-Side)

Plugin tools communicate with browser adapters exclusively through `sendServiceRequest()`. The SDK's request provider pattern means plugins never import the WebSocket relay directly and cannot address other plugins' adapters — the service name is the routing key.

### Runtime Permission Enforcement (Server-Side)

Plugin tools that call `sendBrowserRequest()` (chrome.tabs/windows APIs) are checked at runtime against the plugin's declared `nativeApis` permissions. If a plugin doesn't declare `nativeApis: ['browser']` in its manifest, calls to `sendBrowserRequest()` from that plugin's tools are rejected with a descriptive error. Platform-native tools (browser_*, capture_*, reload_extension) bypass this check. The permission registry is populated during plugin initialization and uses AsyncLocalStorage-based tool ID tracking to identify which plugin a call originates from.

### Network Scoping (Advisory, In-Adapter)

The SDK provides `createScopedFetch()` which restricts `fetch` calls to declared network domains. **This is advisory, not a hard boundary.** Adapters run in the page's MAIN world JavaScript context — they have the same privileges as the page itself. A malicious adapter could call the native `fetch` directly and bypass the scoped wrapper. The real protection comes from the domain isolation layer above: adapters only run on pages matching their declared URL patterns, so the damage surface is limited to the domains the adapter already has legitimate access to.

### Trust Tiers

| Tier | Pattern | Trust |
|------|---------|-------|
| Official | `@opentabs/plugin-*` | Auto-trusted, reviewed by maintainers |
| Community | `opentabs-plugin-*` | User prompted on first install |
| Local | Relative path | Developer's own — no verification |

### What This Model Does NOT Protect Against

- A plugin's adapter running arbitrary code in the page context (MAIN world scripts have full page access — this is by design, same as any browser extension content script)
- A malicious npm package executing arbitrary code in the MCP server process (same trust model as any npm dependency)
- Two plugins injected into the same page overwriting each other's adapter registration (mitigated by URL pattern overlap warnings)

## Plugin Installation

```bash
# Install a plugin
bun add opentabs-plugin-jira

# Rebuild (compiles adapter, registers tools)
bun run build

# The MCP server hot-reloads; call reload_extension for adapter changes
```

## Creating a New Plugin

A plugin needs three things:

1. **`opentabs-plugin.json`** — Declarative manifest (service identity, domains, health check)
2. **Adapter** (`src/adapter.ts`) — MAIN world script using `@opentabs/plugin-sdk/adapter`
3. **Tools** (`src/tools/index.ts`) — MCP tools using `@opentabs/plugin-sdk/server`

```bash
# Scaffold a new plugin from the official template
bunx create-opentabs-plugin my-service --domain app.example.com

# Or for a specific domain with a display name
bunx create-opentabs-plugin google-sheets --domain docs.google.com --display "Google Sheets"
```

The scaffolder generates a complete plugin directory with adapter auth patterns, tool boilerplate, correct peer dependencies, and a comprehensive README.

## What Changed From the Original Architecture

| Aspect | Before (Monolith) | After (Platform + Plugins) |
|--------|-------------------|---------------------------|
| Service registry | Static array in `registry.ts` | Dynamic, built at startup from plugins |
| Adding a service | Edit 5+ files across 3+ packages | Install an npm package |
| Adapter code | `chrome-extension/src/adapters/<service>.ts` | Plugin package: `src/adapter.ts` |
| Tool code | `packages/mcp-server/src/tools/<service>/` | Plugin package: `src/tools/` |
| Service config | Hardcoded in `service-configs.ts` | Derived from `opentabs-plugin.json` |
| Manifest entries | Generated from static registry | Generated from dynamic registry (includes plugins) |
| Options page | Hardcoded per-service tool lists | Auto-generated from plugin manifests |
| Distribution | Fork the repo | `npm publish` / `bun add` |
| Community contribution | PR to monorepo | Publish your own npm package |

## Implementation Status

- [x] `@opentabs/core` — Complete (types, JSON-RPC, messaging, services, plugin manifest)
- [x] `@opentabs/plugin-sdk` — Complete (adapter utilities, server utilities, definePlugin, extensible error patterns, runtime permission enforcement)
- [x] `@opentabs/plugin-loader` — Complete (discover, Zod-based validation, merge, skipRegistryMerge for hot reload, URL pattern overlap detection)
- [x] `@opentabs/mcp-server` — Partial (plugin-init with permission wiring, tools/index, browser tools, extension tools, capture tools)
- [ ] `@opentabs/mcp-server` — Remaining (server.ts, http-server.ts, websocket-relay.ts, hot-reload.ts, config.ts)
- [ ] `@opentabs/browser-extension` — Partial (capture handler with interceptor injection, content script relay; remaining: background script entry, adapter manager, mcp-router, service controllers, offscreen manager, manifest generation)
- [x] `create-opentabs-plugin` — Complete (CLI scaffolder, template with adapter patterns, tools boilerplate, tsconfig.build.json, comprehensive README)
- [x] `@opentabs/plugin-slack` — Partial (adapter, messages, search, types, isHealthy, error patterns)
- [ ] `@opentabs/plugin-slack` — Remaining (channels, conversations, users, files, pins, stars, reactions)
- [ ] Build system integration (Vite adapter builds, manifest generation)
- [ ] Options page auto-generation from plugin manifests
- [ ] CLI tooling (`opentabs plugins add/remove/list`)
- [ ] Plugin testing utilities (`@opentabs/plugin-test-utils`)
- [x] AI-assisted plugin creation — Partial (capture MCP tools defined, analysis logic implemented, scaffold tool wired, verify tool for plugin readiness checks, extension-side capture handler + content script relay)
- [ ] AI-assisted plugin creation — Remaining (wire capture handler into BrowserController action dispatch, register capture content script dynamically on capture_start, background message listener for `capture_request` messages)
- [x] Runtime permission enforcement — Complete (nativeApis checks via permission registry + AsyncLocalStorage)
- [ ] Plugin registry website

## Changelog

### Session 5 (2025-07-14)

- **Fixed**: Missing `tsconfig.build.json` in plugin template — The template's `package.json` references `tsc -p tsconfig.build.json` but only `tsconfig.json` existed. Added the missing file so scaffolded plugins build successfully out of the box.
- **Fixed**: Template URL pattern generation for leading-dot domains — When a domain starts with `.` (e.g. `.slack.com`), the scaffolder now generates `*://*.slack.com/*` instead of the invalid `*://.slack.com/*`. Added computed `{{urlPattern}}` and `{{networkDomain}}` template variables that handle both exact and wildcard domain formats.
- **Fixed**: Hot-reload module caching in `loadPluginModule` — Dynamic `import()` calls cache by URL. Added a `?t=${Date.now()}` cache-busting query parameter so that re-imports during hot reload pick up fresh code instead of returning stale cached modules.
- **Fixed**: Double validation in plugin resolution pipeline — `loadPlugins` validated manifests in step 2, then `resolvePlugin` validated the same manifest again in step 1. Refactored to use `{discovered, manifest}` pairs throughout the pipeline so the pre-validated manifest is passed directly to `resolvePlugin`, eliminating redundant work and keeping parallel array indices in sync during the name-conflict dedup step.
- **Fixed**: Stale `validate.ts` reference in `discover.ts` module doc comment — Updated to reference `manifest-schema.ts` which replaced it in Session 3.
- **Added**: URL pattern overlap detection (`checkUrlPatternOverlaps`) in `@opentabs/plugin-loader` — Detects when two plugins' URL patterns could match the same pages, which would cause adapter registration conflicts on `window.__openTabs.adapters`. Uses host extraction and wildcard-aware overlap checking. Wired into `loadPlugins` as a warning (not fatal) after name conflict checks.
- **Added**: Extension-side capture handler (`browser-extension/src/background/capture-handler.ts`) — `CaptureHandler` class that manages per-tab capture sessions, injects fetch/XHR interceptors into the page's MAIN world via `chrome.scripting.executeScript`, stores captured request metadata, and provides action handlers for all capture-related browser controller operations (startCapture, stopCapture, captureStatus, getCapturedRequests, clearCapture, getPageScripts, fetchScript, inspectAuth). Interceptor patches both `window.fetch` and `XMLHttpRequest.prototype` to capture URL, method, headers, status, content type, timing, and optionally response bodies. Includes auto-stop when maxRequests threshold is reached and guards against double-injection.
- **Added**: Capture content script relay (`browser-extension/src/capture-content-script.ts`) — Bridge between the MAIN world interceptor (which cannot access Chrome extension APIs) and the background script. Listens for `window.postMessage` events with type `__opentabs_capture__` and forwards them via `chrome.runtime.sendMessage` to the background script's `CaptureHandler.addRequest()`. Designed to be registered dynamically when capture starts and unregistered when it stops.
- **Added**: Auth inspection script in capture handler — `inspectAuth` action that examines localStorage, sessionStorage, cookies, meta tags, and common JavaScript globals for auth-related keys. Values are partially redacted for security (first 8-30 chars visible). Helps AI agents determine the correct auth extraction strategy for a new plugin's adapter.
- **Fixed**: Fragile CLI entry detection in `create-opentabs-plugin` — Replaced string-matching heuristic (`process.argv[1].includes('create-plugin')`) with robust `import.meta.url === pathToFileURL(resolve(process.argv[1])).href` comparison. The old detection could false-positive on unrelated scripts with "create-plugin" in their path.
- **Fixed**: `createScopedFetch` doc comment in `@opentabs/plugin-sdk/adapter` — Was described as "The platform uses this to wrap the adapter's fetch calls to enforce this allowlist" which implied automatic enforcement. Rewritten to honestly describe it as an opt-in helper for defense-in-depth, clarifying that MAIN world adapters have full access to the native `fetch` and the real isolation boundary is Chrome's content script URL matching.
- **Replaced**: No-op `capture_test_plugin` tool with `capture_verify_plugin` — The old tool couldn't actually test anything (tools can't invoke other tools). The new tool performs real checks: queries the extension for service registration status, verifies tab connectivity, and checks whether the adapter is loaded on the page via `executeScript`. Returns structured diagnostics with actionable fix suggestions for each failing check.
- **Changed**: Security model documentation — Rewrote to honestly describe MAIN world limitations. `createScopedFetch` is now documented as advisory (not a hard boundary). Added explicit "What This Model Does NOT Protect Against" section. Documented URL pattern overlap detection as a security mitigation.

### Session 4 (2026-02-10)

- **Deleted**: `validate.ts` from `@opentabs/plugin-loader` — Superseded by `manifest-schema.ts` (Zod-based) in Session 3. Removed stale `./validate` export path from `package.json` and consolidated barrel exports in `index.ts`.
- **Fixed**: Slack plugin `@opentabs/plugin-sdk` dependency conflict — Was listed in both `dependencies` and `peerDependencies`, which causes npm to install a nested copy defeating singleton guarantees. Moved to `devDependencies` only (for monorepo workspace resolution); `peerDependencies` declares the version range for published consumers.
- **Fixed**: Zod peer dependency range in `@opentabs/plugin-sdk` and `@opentabs/plugin-slack` — Changed from `>=3.0.0` to `^4.0.0`. Zod 4 has breaking changes from Zod 3, and the `@modelcontextprotocol/sdk` requires Zod 4. The loose range would silently accept incompatible Zod 3 installations.
- **Added**: Runtime `nativeApis` permission enforcement in `@opentabs/plugin-sdk/server` — New permission registry (`__registerPluginPermissions`, `hasNativeApiPermission`) that maps plugin names to their declared `nativeApis` permissions. `sendBrowserRequest()` now checks this registry and rejects calls from plugins that didn't declare `'browser'` in their manifest. Platform-native tools (prefixed `browser_`, `capture_`, `reload_extension`) bypass the check. Uses AsyncLocalStorage tool ID tracking to identify the calling plugin. Fail-closed: unknown plugins are denied by default.
- **Changed**: Plugin initialization wires permission registry — `plugin-init.ts` now calls `__registerPluginPermissions()` for each loaded plugin during startup and hot reload, populating the enforcement registry from manifest declarations.
- **Removed**: Hardcoded Slack/Snowflake health check evaluators from `merge.ts` — `resolveBuiltinEvaluator()` contained service-specific logic (`slack-api-ok-field`, `snowflake-user-field`) that belongs in plugins, not the platform. Replaced with `resolveHealthCheckEvaluator()` that validates the plugin's `isHealthy` export backs the declared evaluator name, and logs a warning if a plugin declares a custom evaluator without exporting `isHealthy`.
- **Fixed**: `refreshPluginTools()` hot-reload strategy — Was catching "registry is frozen" errors and returning empty results, defeating the purpose of hot reload. Now uses `skipRegistryMerge: true` option in `loadPlugins()` to cleanly bypass registry freezing while still re-discovering and re-importing plugin tool modules.
- **Added**: `skipRegistryMerge` option to `loadPlugins()` — Allows hot-reload to re-run the full discovery→validate→load pipeline without hitting the frozen registry guard. The returned `registry` reflects what would be merged without actually calling `setServiceRegistry()`.
- **Added**: `create-opentabs-plugin` package — CLI scaffolder and programmatic API for generating new plugins from the official template. Includes template files: `opentabs-plugin.json`, `adapter.ts` with documented auth patterns (cookie, localStorage, CSRF, JS globals), `tools/index.ts` with `registerTools` + `isHealthy` boilerplate, `tools/general.ts` with example tool definitions, `package.json` with correct peer/dev deps, `tsconfig.json`, and a comprehensive `README.md` plugin development guide.
- **Added**: Capture tools for AI-assisted plugin creation (`capture/index.ts`) — 10 new platform-native MCP tools: `capture_start`, `capture_stop`, `capture_status` (capture control); `capture_get_requests`, `capture_clear` (data retrieval); `capture_analyze` (API catalog generation with endpoint grouping, auth pattern detection, path normalization); `capture_get_page_scripts`, `capture_fetch_script`, `capture_inspect_auth` (page inspection); `capture_scaffold_plugin` (plugin generation via create-opentabs-plugin); `capture_test_plugin`, `capture_plugin_debug` (development lifecycle). Analysis logic includes URL path normalization (UUID/ID collapsing), auth pattern detection (Bearer, cookie, API key, CSRF), and endpoint grouping with deduplication.

### Session 3 (2026-02-10)

- **Removed**: `sendSlackEdgeRequest` from `@opentabs/plugin-sdk/server` — Slack-specific method leaked into the generic SDK. Slack's Edge API is already accessible via the generic `sendServiceRequest('slack', params, 'edgeApi')` action parameter. Removed from `RequestProvider` interface and SDK exports.
- **Added**: Extensible error pattern registry in `@opentabs/plugin-sdk/server` — Split error patterns into platform-level (connection, timeout, HTTP codes) and plugin-registered. Added `registerErrorPatterns()` public API and `__resetErrorPatterns()` for tests. Plugins register domain-specific patterns at module load time.
- **Moved**: Slack-specific error patterns from SDK to `@opentabs/plugin-slack` — Patterns for `channel_not_found`, `not_in_channel`, `invalid_auth`, `ratelimited`, `missing_scope`, `user_not_found`, plus new patterns for `token_revoked`, `no_text`, `message_not_found`, `cant_delete_message`, `cant_update_message`. Registered via the new `registerErrorPatterns()` API.
- **Added**: `isJsonRpcError` re-export from `@opentabs/plugin-sdk/server` — So plugins can import everything they need from the SDK without direct `@opentabs/core` dependency.
- **Fixed**: `@opentabs/plugin-loader` dependency graph — Removed unnecessary `@opentabs/plugin-sdk` dependency (none of the loader's source files imported from it). Removed from both `package.json` and `tsconfig.json` references.
- **Replaced**: Hand-rolled validation (~750 lines) with Zod schema in `@opentabs/plugin-loader` — Created `manifest-schema.ts` with declarative Zod schema covering all manifest fields, cross-field consistency (environment↔domain, health check method prefix, network permission coverage), and same `ValidationResult`/`ValidationError` API. Enables future JSON Schema generation via `zod-to-json-schema`. Added `zod` as dependency of `plugin-loader`.
- **Changed**: `merge.ts` imports from `manifest-schema.js` instead of `validate.js` — Completes the Zod migration. The old `validate.ts` is superseded but retained for reference until confirmed safe to delete.
- **Changed**: Slack plugin imports use `@opentabs/plugin-sdk` re-exports instead of direct `@opentabs/core` — `isJsonRpcError` and types now imported from SDK, reducing the plugin's dependency surface.
- **Added**: Implementation status items for plugin template, test utils, AI-assisted creation, and runtime permission enforcement — Tracks remaining work identified during architecture review.