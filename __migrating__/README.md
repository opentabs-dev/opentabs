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
│   │       └── server.ts              # MCP tool registration utilities
│   │
│   ├── plugin-loader/                 # @opentabs/plugin-loader
│   │   └── src/
│   │       ├── index.ts               # Barrel export
│   │       ├── discover.ts            # Scan node_modules for plugins
│   │       ├── validate.ts            # Validate opentabs-plugin.json
│   │       └── merge.ts               # Merge plugins into platform registry
│   │
│   ├── mcp-server/                    # @opentabs/mcp-server
│   │   └── src/
│   │       ├── plugin-init.ts         # Plugin system initialization
│   │       └── tools/
│   │           ├── index.ts           # Plugin-aware tool registration
│   │           ├── browser/tabs.ts    # Platform-native: browser tab tools
│   │           └── extension/reload.ts # Platform-native: extension reload
│   │
│   └── browser-extension/             # @opentabs/browser-extension
│       └── src/
│           └── background/            # Plugin-aware background script
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
@opentabs/plugin-loader           ← Depends on core + plugin-sdk. Discovery & validation.
    ↑
@opentabs/mcp-server              ← Depends on core + plugin-sdk + plugin-loader.
@opentabs/browser-extension       ← Depends on core + plugin-loader.

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

**Validation** (`validate.ts`):
- Validates `opentabs-plugin.json` against the platform schema
- Checks name patterns, version format, URL patterns, domain consistency
- Cross-field validation (health check method prefix, domain/permission alignment)
- Name conflict detection across plugins
- Rejects overly broad URL patterns (`*://*/*`) and reserved names

**Merge** (`merge.ts`):
- Converts `PluginManifest` → `ServiceDefinition` for the service registry
- Converts `PluginManifest` → `WebappServiceConfig` for service controllers
- Dynamically imports plugin tool modules (`registerTools` + `isHealthy`)
- Resolves built-in health check evaluators by name
- `loadPlugins()` — the primary entry point that runs the full pipeline

### `@opentabs/mcp-server`

The MCP server, refactored to be plugin-aware. Contains only:

- **Platform infrastructure**: HTTP server, WebSocket relay, hot reload, config
- **Platform-native tools**: Browser tab tools, extension reload tool
- **Plugin initialization** (`plugin-init.ts`): Wires the plugin-loader into the server startup

Service-specific tools (Slack, Datadog, etc.) are **gone from this package** — they live in plugins. The `tools/index.ts` has a `setPluginRegistrations()` function that the plugin initializer calls to inject discovered plugin tools into the registration pipeline.

### `@opentabs/browser-extension`

The Chrome extension, refactored to be a generic adapter runtime. Contains:

- **Background script**: MCP router, adapter manager, service controllers, offscreen manager
- **No service-specific code**: All adapters come from plugins

The adapter manager uses the plugin-loader to discover plugin adapters and register them as MAIN world content scripts. Service controller configs are built from plugin manifests.

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

### Domain Isolation

Plugin adapters are ONLY injected into URLs matching their declared `urlPatterns`. The browser enforces this at the content script level — a Slack plugin physically cannot access a Jira page.

### Manifest Validation

The plugin-loader validates every manifest at build time:
- URL patterns must be scoped to specific domains (no `*://*/*`)
- Network permissions must cover declared adapter domains
- Plugin names must not collide with reserved platform names
- Health check methods must be prefixed with the plugin name

### Request Provider Scoping

Plugin tools communicate with browser adapters exclusively through `sendServiceRequest()`. The SDK's request provider pattern means plugins never import the WebSocket relay directly and cannot access other plugins' adapters.

### Trust Tiers

| Tier | Pattern | Trust |
|------|---------|-------|
| Official | `@opentabs/plugin-*` | Auto-trusted, reviewed by maintainers |
| Community | `opentabs-plugin-*` | User prompted on first install |
| Local | Relative path | Developer's own — no verification |

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
# Future: scaffold generator
bunx create-opentabs-plugin my-service
```

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
- [x] `@opentabs/plugin-sdk` — Complete (adapter utilities, server utilities, definePlugin)
- [x] `@opentabs/plugin-loader` — Complete (discover, validate, merge)
- [x] `@opentabs/mcp-server` — Partial (plugin-init, tools/index, browser tools, extension tools)
- [ ] `@opentabs/mcp-server` — Remaining (server.ts, http-server.ts, websocket-relay.ts, hot-reload.ts, config.ts)
- [ ] `@opentabs/browser-extension` — Scaffolded (background script stubs)
- [x] `@opentabs/plugin-slack` — Partial (adapter, messages, search, types, isHealthy)
- [ ] `@opentabs/plugin-slack` — Remaining (channels, conversations, users, files, pins, stars, reactions)
- [ ] Build system integration (Vite adapter builds, manifest generation)
- [ ] Options page auto-generation from plugin manifests
- [ ] CLI tooling (`opentabs plugins add/remove/list/create`)
- [ ] Plugin registry website