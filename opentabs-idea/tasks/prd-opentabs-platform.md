# PRD: OpenTabs — Open Plugin Platform for Browser-Authenticated AI Tool Access

## Introduction

OpenTabs is an open-source platform that enables AI agents (Claude Code, etc.) to interact with any web application through the user's authenticated browser session. Instead of setting up API tokens, managing rate limits, or paying for enterprise API access, users leverage the sessions they already have — **"zero tokens, full access."**

The platform provides a plugin SDK so anyone can create an integration for any website. Plugin authors write a single TypeScript class that runs inside the target web page's JavaScript context (MAIN world), using standard browser APIs (`fetch`, `document`, `localStorage`) with the page's own cookies and session. The platform handles everything else: MCP tool registration, browser extension injection, input/output validation, hot reload, and distribution via npm.

### Problem

1. **API limitations**: Many web services don't provide MCP servers, have restrictive APIs, low rate limits, or require expensive enterprise plans for programmatic access. Users already have authenticated browser sessions with full access — OpenTabs leverages those sessions.

2. **Token friction**: Setting up API tokens often requires admin permissions, OAuth flows, or enterprise subscriptions. Many developers simply want their AI agent to do what they can already do in their browser.

3. **No plugin ecosystem**: There's no standard way for the community to create browser-session-based integrations. Each team builds ad hoc solutions. OpenTabs provides the SDK, distribution, and runtime so the community can build once and share.

### Core Architectural Insight

The plugin's adapter code runs in the **MAIN world** of the target web page. From the browser's perspective, the adapter IS the page's own JavaScript. When Slack's code calls `fetch('/api/chat.postMessage')`, the browser attaches cookies and CSRF tokens. The adapter's identical `fetch` call gets the same treatment. No special permissions needed — the URL pattern matching (controlled by the extension) is the only security boundary.

## Goals

- Ship a plugin SDK (`@opentabs/plugin-sdk`) with an abstract `OpenTabsPlugin` class and `defineTool()` factory
- Ship an MCP server (`@opentabs/mcp-server`) that discovers plugins, registers MCP tools from manifests, routes tool calls through the extension, and hot-reloads via `bun --hot`
- Ship a Chrome extension that injects plugin adapters into matching tabs, dispatches tool calls via `chrome.scripting.executeScript`, and communicates with the MCP server over WebSocket
- Ship the Slack plugin as a **separate project** (not a workspace member) that serves as the DX acceptance test — using the identical SDK as any community plugin
- Ship `opentabs build` CLI that validates, generates JSON Schema from Zod, and bundles the adapter IIFE
- Ship `create-opentabs-plugin` scaffolding CLI
- Support community plugins via npm (`opentabs-plugin-*` naming convention) with automatic discovery
- Support local plugin installation via filesystem paths in `~/.opentabs/config.json`
- Enable hot reload of local plugins with file watching (MCP server detects IIFE changes, re-injects without tab or extension reload)
- Establish the autonomous development loop (Phase 0) so AI agents can iterate with zero human involvement

## Plugin SDK

### Abstract Plugin Class

Plugin authors extend `OpenTabsPlugin` and export an instance. The platform provides the abstract class:

```typescript
// @opentabs/plugin-sdk

import type { z } from 'zod'

interface ToolDefinition<
  TInput extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Tool name — auto-prefixed with plugin name (e.g., 'send_message' → 'slack_send_message') */
  name: string
  /** Human-readable description shown to MCP clients / AI agents */
  description: string
  /** Zod schema — used for MCP registration + server-side input validation */
  input: TInput
  /** Zod schema — used for server-side output validation */
  output: TOutput
  /** Execute the tool. Runs in the browser page context. Input is pre-validated. */
  handle(params: z.infer<TInput>): Promise<z.infer<TOutput>>
}

/** Type-safe factory — identity function that provides generic inference */
function defineTool<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput extends z.ZodType,
>(config: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput>

/**
 * Abstract base class for all OpenTabs plugins.
 * Plugin authors extend this and export an instance.
 */
abstract class OpenTabsPlugin {
  /** Unique identifier (lowercase alphanumeric + hyphens) */
  abstract readonly name: string
  /** Semver version string */
  abstract readonly version: string
  /** Brief description of the plugin's purpose */
  abstract readonly description: string
  /**
   * Chrome match patterns — determines which tabs get the adapter injected.
   * @see https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
   */
  abstract readonly urlPatterns: string[]
  /** All tool definitions for this plugin */
  abstract readonly tools: ToolDefinition[]
  /**
   * Readiness probe (Kubernetes convention).
   * Called by the extension to determine if the service in the current
   * tab is ready to accept tool requests. Runs in the page context.
   *
   * Tab state mapping:
   *   - No matching tab exists     → 'closed'
   *   - Tab exists, isReady=false  → 'unavailable'
   *   - Tab exists, isReady=true   → 'ready'
   *
   * @returns true if the user is authenticated and the service is operational
   */
  abstract isReady(): Promise<boolean>
  /** Human-readable display name. Defaults to `name` if not set. */
  displayName?: string
}

/**
 * Typed error for tool handlers — the platform catches these
 * and returns structured MCP error responses.
 */
class ToolError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., 'CHANNEL_NOT_FOUND') */
    public readonly code: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}
```

### Usage Example — Slack Plugin

```typescript
// plugins/slack/src/tools/send-message.ts
import { defineTool } from '@opentabs/plugin-sdk'
import { z } from 'zod'

export const sendMessage = defineTool({
  name: 'send_message',
  description: 'Send a message to a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel name or ID'),
    text: z.string().describe('Message body (supports mrkdwn)'),
  }),
  output: z.object({
    ok: z.boolean(),
    ts: z.string().describe('Message timestamp (unique ID)'),
    channel: z.string(),
  }),
  async handle(params) {
    const res = await fetch('/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ channel: params.channel, text: params.text }),
    })
    const data = await res.json()
    if (!data.ok) throw new ToolError(data.error, data.error)
    return { ok: data.ok, ts: data.ts, channel: data.channel }
  },
})
```

```typescript
// plugins/slack/src/index.ts
import { OpenTabsPlugin } from '@opentabs/plugin-sdk'
import { sendMessage } from './tools/send-message.js'
import { searchMessages } from './tools/search.js'

class SlackPlugin extends OpenTabsPlugin {
  name = 'slack' as const
  displayName = 'Slack'
  version = '1.0.0'
  description = 'Interact with Slack workspaces through your browser session'
  urlPatterns = ['*://app.slack.com/*']
  tools = [sendMessage, searchMessages]

  async isReady() {
    try {
      const res = await fetch('/api/auth.test', { method: 'POST' })
      const data = await res.json()
      return data.ok === true
    } catch {
      return false
    }
  }
}

export default new SlackPlugin()
```

### Tool Name Prefixing

Tool names are auto-prefixed with the plugin name derived from the npm package name (minus `opentabs-plugin-`):

- Package `opentabs-plugin-slack` → plugin name `slack` → tool `send_message` → MCP tool `slack_send_message`
- Package `@myorg/opentabs-plugin-jira` → plugin name `myorg-jira` → tool `create_issue` → MCP tool `myorg-jira_create_issue`

The plugin's `name` field in the class MUST match the derived npm package name. The platform validates this at discovery time. npm uniqueness guarantees no prefix collisions.

## Package Architecture & Local Development

### npm-Publish-Ready, Local-First Development

All platform packages (`@opentabs/plugin-sdk`, `@opentabs/mcp-server`, etc.) are structured as proper npm packages — correct `exports` map, `files` array, `types`, `peerDependencies` — ready to `npm publish` at any time. However, during development **nothing is published to npm**. All cross-package references use local `file:` dependencies.

This applies to every package in the system:
- `@opentabs/mcp-server` depends on `@opentabs/plugin-sdk` via `"file:../plugin-sdk"`
- `@opentabs/plugin-slack` depends on `@opentabs/plugin-sdk` via `"file:../../platform/plugin-sdk"`
- The Chrome extension depends on platform packages via local references

When the platform goes to production, `file:` references are swapped to published npm versions. The code itself does not change — only `package.json` dependency specifiers.

**Why this matters:**
- Proves the package boundaries work for external consumers (no hidden internal shortcuts)
- Publishing is a distribution concern, not a development concern
- Any package can be published independently when ready

### npm Distribution (Production)

Plugins are npm packages. Users install with `bun add opentabs-plugin-slack`. The platform auto-discovers plugins from `node_modules`.

Discovery rules:
- Packages matching `opentabs-plugin-*` or `@*/opentabs-plugin-*`
- Packages with `opentabs-plugin` keyword in `package.json`
- Explicit paths in `~/.opentabs/config.json`

### npm Package Structure

```
opentabs-plugin-slack/
├── package.json              ← keywords: ["opentabs-plugin"], peerDeps on SDK
├── opentabs-plugin.json      ← manifest: tool metadata, JSON Schemas, URL patterns
├── dist/
│   └── adapter.iife.js       ← browser-injectable bundle
└── src/                      ← source (not consumed by platform at runtime)
```

### Plugin Manifest (opentabs-plugin.json)

Auto-generated by `opentabs build` from the plugin class. Never hand-authored.

```json
{
  "name": "opentabs-plugin-slack",
  "version": "1.0.0",
  "displayName": "Slack",
  "description": "Interact with Slack workspaces through your browser session",
  "url_patterns": ["*://app.slack.com/*"],
  "tools": [
    {
      "name": "send_message",
      "description": "Send a message to a Slack channel",
      "input_schema": { "type": "object", "properties": { "channel": { "type": "string" }, "text": { "type": "string" } }, "required": ["channel", "text"] },
      "output_schema": { "type": "object", "properties": { "ok": { "type": "boolean" }, "ts": { "type": "string" }, "channel": { "type": "string" } } }
    }
  ]
}
```

### Local Plugin Installation

For development and private plugins, filesystem paths are supported:

```json
// ~/.opentabs/config.json
{
  "plugins": [
    "/Users/dev/opentabs/plugins/slack",
    "/Users/dev/my-private-plugin"
  ]
}
```

The MCP server reads the plugin's `opentabs-plugin.json` and `dist/adapter.iife.js` from the local path. Same code path as npm-installed plugins.

### Plugin Build Tooling

**`opentabs build`** — provided by the SDK. Runs as part of the plugin's build step:

```json
// plugins/slack/package.json
{
  "scripts": {
    "build": "tsc && opentabs build",
    "dev": "bun run build --watch"
  }
}
```

`opentabs build` does:
1. Imports the plugin module, reads the exported class instance
2. Extracts metadata: `name`, `version`, `description`, `urlPatterns`
3. Reads tool definitions: `name`, `description`, Zod input/output schemas
4. Converts Zod schemas → JSON Schema
5. Validates: URL patterns not overly broad, no reserved names, schemas valid, all required fields present
6. Writes `opentabs-plugin.json` (manifest with JSON Schemas)
7. Bundles the plugin source into `dist/adapter.iife.js` (self-contained IIFE for browser injection)

**`create-opentabs-plugin`** — scaffolding CLI:

```bash
bunx create-opentabs-plugin jira --domain .atlassian.net
```

Generates a ready-to-build plugin project with: `package.json`, `tsconfig.json`, `src/index.ts` (plugin class), `src/tools/example.ts` (sample tool). Delegates build and dev workflow to bun.

### Plugin Updates

On startup, the MCP server checks installed npm plugins for newer versions (non-blocking). Results are logged with the `bun update` command. Actual updating is deferred to `bun update` — the platform never auto-updates plugins.

## Architecture

### Component Roles

| Component | Role | Key Property |
|-----------|------|-------------|
| **MCP Server** | The brain. Orchestrates everything. | Source of truth for config, tool state, plugin registry. |
| **Chrome Extension** | Dumb pipe. Executes what MCP server tells it. | No decision-making logic. Offscreen document maintains WebSocket. |
| **Side Panel** | Pure display + toggle controls. | Reads from MCP server, sends mutations back. Greyed out when disconnected. |
| **`~/.opentabs/config.json`** | Single config file. | Editable via side panel, CLI, or text editor. |

### MCP Server

- Discovers plugins from `node_modules` and local paths
- Reads `opentabs-plugin.json` manifests to register MCP tools (Zod schemas pre-compiled to JSON Schema)
- Caches adapter IIFEs and sends them to the extension as install payloads
- Routes tool calls: validates input → sends to extension via WebSocket → receives result → validates output → returns to MCP client
- Maintains tab-to-plugin mapping (updated by push events from extension)
- Runs via `bun --hot` for maximum hot-reloadability — even the MCP server itself should be hot-reloadable
- Watches local plugin directories (`fs.watch`) for IIFE/manifest changes, triggers re-injection
- Exposes config operations for the side panel
- Broadcasts tool activity events (invocation start/end) for side panel animation

### Chrome Extension

- **Background script**: Message router between WebSocket, tabs, and side panel
- **Offscreen document**: Maintains persistent WebSocket connection to MCP server. Auto-reconnects with exponential backoff.
- **Side panel**: React app (see Side Panel section)
- **Adapter injection**: Stores IIFEs in `chrome.storage.local`. Injects into matching tabs via `chrome.scripting.executeScript` (MAIN world). Multiple injection approaches may be needed to handle CSP — the implementation should discover and use the method with least friction.
- **Adapter dispatch**: `chrome.scripting.executeScript` with `func` that calls the already-loaded adapter's `handle()` method (same pattern as current code)
- **Tab state push**: Listens to `chrome.tabs.onUpdated`, `chrome.tabs.onRemoved`, etc. Pushes state deltas to MCP server via WebSocket (no polling)
- **Extension reload**: MCP server can trigger `chrome.runtime.reload()` for platform development. Extension auto-reconnects after reload.

### Tab State Model

| State | Meaning | Side Panel | Tool Response |
|-------|---------|------------|---------------|
| `closed` | No browser tab matching the plugin's URL patterns | Red indicator | `"Open app.slack.com in your browser to use this tool"` |
| `unavailable` | Tab open, adapter injected, but `isReady()` returned false | Yellow indicator | `"Slack is not ready — please sign in at app.slack.com"` |
| `ready` | Tab open, adapter injected, `isReady()` passed | Green indicator | Tool executes normally |

### Tab State Push Model

The extension pushes tab state changes to the MCP server (no polling):

```
Chrome tab events (onUpdated, onRemoved, onCreated)
  → Extension detects URL match change or tab close
  → Extension pushes tab.stateChanged to MCP server via WebSocket
  → MCP server updates its internal mapping
  → Side panel and CLI read from MCP server's cached mapping
```

On startup/reconnect, the extension sends a full `tab.syncAll` with current state.

### Permission Model

**No Chrome API proxy needed.** The adapter runs in MAIN world and has the same privileges as the page's own JavaScript:
- `fetch` with the page's cookies (same-origin)
- `document.cookie` (non-httpOnly)
- `localStorage` / `sessionStorage`
- Full DOM access

The URL pattern matching (controlled by the extension) IS the security boundary. A plugin can only do what the page's own JavaScript can do, and ONLY on pages matching its declared URL patterns.

### Trust Tiers

| Tier | Criteria | Side Panel Badge |
|------|----------|-----------------|
| `official` | Published under `@opentabs/` npm scope | Official |
| `community` | npm package with `opentabs-plugin` keyword | Community |
| `local` | Filesystem path in config | Local |

## MCP Server ↔ Extension Protocol

All communication uses **JSON-RPC 2.0** over WebSocket. Messages with `id` expect a response. Messages without `id` are notifications (fire-and-forget).

### Connection & Initial Sync

```jsonc
// Server → Extension: send full state on connect
{ "jsonrpc": "2.0", "method": "sync.full", "params": {
    "plugins": [{
      "name": "slack", "version": "1.0.0", "displayName": "Slack",
      "urlPatterns": ["*://app.slack.com/*"], "trustTier": "official",
      "iife": "(function(){ ... })()",
      "tools": [
        { "name": "send_message", "description": "Send a message", "enabled": true }
      ]
    }]
  }
}

// Extension → Server: report current tab state
{ "jsonrpc": "2.0", "method": "tab.syncAll", "params": {
    "tabs": {
      "slack": { "state": "ready", "tabId": 123, "url": "https://app.slack.com/client/T123" },
      "jira": { "state": "closed" }
    }
  }
}
```

### Plugin Hot Reload (local plugin IIFE changed)

```jsonc
// Server → Extension (request)
{ "jsonrpc": "2.0", "method": "plugin.update", "params": {
    "name": "slack", "version": "1.0.1", "urlPatterns": ["*://app.slack.com/*"],
    "iife": "(function(){ ... updated ... })()",
    "tools": [{ "name": "send_message", "description": "Send a message (v2)", "enabled": true }]
  }, "id": 1
}

// Extension → Server (response)
{ "jsonrpc": "2.0", "result": { "reinjectedTabs": [123, 456] }, "id": 1 }
```

### Plugin Uninstall

```jsonc
// Server → Extension
{ "jsonrpc": "2.0", "method": "plugin.uninstall", "params": { "name": "slack" }, "id": 2 }
// Extension → Server
{ "jsonrpc": "2.0", "result": { "success": true }, "id": 2 }
```

### Tool Dispatch (Critical Path)

```jsonc
// Server → Extension
{ "jsonrpc": "2.0", "method": "tool.dispatch", "params": {
    "plugin": "slack", "tool": "send_message",
    "input": { "channel": "#general", "text": "hello" }
  }, "id": 3
}

// Extension → Server (success)
{ "jsonrpc": "2.0", "result": {
    "output": { "ok": true, "ts": "1707580800.000100", "channel": "C1234" }
  }, "id": 3
}

// Extension → Server (error — no tab)
{ "jsonrpc": "2.0", "error": {
    "code": -32001, "message": "Open app.slack.com in your browser to use this tool"
  }, "id": 3
}

// Extension → Server (error — not ready)
{ "jsonrpc": "2.0", "error": {
    "code": -32002, "message": "Slack is not ready — please sign in at app.slack.com"
  }, "id": 3
}
```

### Tab State Push

```jsonc
// Extension → Server (notification — no response)
{ "jsonrpc": "2.0", "method": "tab.stateChanged", "params": {
    "plugin": "slack", "state": "ready", "tabId": 123,
    "url": "https://app.slack.com/client/T123/C456"
  }
}
```

### Tool Activity (for Side Panel)

```jsonc
// Server → Extension (notifications)
{ "jsonrpc": "2.0", "method": "tool.invocationStart", "params": {
    "plugin": "slack", "tool": "send_message", "ts": 1707580800000
  }
}
{ "jsonrpc": "2.0", "method": "tool.invocationEnd", "params": {
    "plugin": "slack", "tool": "send_message", "durationMs": 450, "success": true
  }
}
```

### Config — Side Panel Operations

```jsonc
// Extension → Server: get full state (side panel opened)
{ "jsonrpc": "2.0", "method": "config.getState", "params": {}, "id": 4 }

// Server → Extension
{ "jsonrpc": "2.0", "result": {
    "plugins": [{
      "name": "slack", "displayName": "Slack", "version": "1.0.0",
      "trustTier": "official", "tabState": "ready",
      "tools": [
        { "name": "send_message", "description": "Send a message", "enabled": true },
        { "name": "search_messages", "description": "Search messages", "enabled": false }
      ]
    }]
  }, "id": 4
}

// Extension → Server: toggle a tool
{ "jsonrpc": "2.0", "method": "config.setToolEnabled", "params": {
    "plugin": "slack", "tool": "send_message", "enabled": false
  }, "id": 5
}

// Extension → Server: toggle all tools for a plugin
{ "jsonrpc": "2.0", "method": "config.setAllToolsEnabled", "params": {
    "plugin": "slack", "enabled": true
  }, "id": 6
}
```

### Extension Reload (Platform Development)

```jsonc
// Server → Extension
{ "jsonrpc": "2.0", "method": "extension.reload", "params": {}, "id": 7 }
// Extension sends response, then calls chrome.runtime.reload()
{ "jsonrpc": "2.0", "result": { "reloading": true }, "id": 7 }
```

### Keepalive

```jsonc
{ "jsonrpc": "2.0", "method": "ping" }
{ "jsonrpc": "2.0", "method": "pong" }
```

### Error Codes

| Code | Meaning |
|------|---------|
| `-32001` | Tab closed — no matching tab for plugin |
| `-32002` | Tab unavailable — tab exists but `isReady()` returned false |
| `-32003` | Tool disabled — tool is toggled off in config |
| `-32600` | Invalid request (JSON-RPC standard) |
| `-32601` | Method not found (JSON-RPC standard) |
| `-32602` | Invalid params (JSON-RPC standard) |
| `-32603` | Internal error (JSON-RPC standard) |

## Side Panel

React app using the existing `@extension/ui` retro component library (RetroCard, RetroSwitch, RetroButton, etc.), Tailwind CSS, and lucide-react icons. Copy the design language from the existing options page and side panel.

### Layout

- **Header**: OpenTabs logo + tagline + connectivity indicator (green dot when MCP connected, red when disconnected)
- **Plugin list**: Each plugin is an expandable card showing:
  - Plugin name + version + trust tier badge (Official / Community / Local)
  - Tab state indicator (green/yellow/red) with contextual hint text
  - Enable all / disable all toggle
  - Individual tool list with per-tool toggle switches
  - Tool activity pulse animation (during invocation)
- **Footer**: Settings link, feedback link
- **Disconnected state**: Everything greyed out. Prominent "MCP server not connected" message.

### Data Source

The side panel communicates with the MCP server through the background script (which relays over WebSocket). It does NOT use `chrome.storage.local` or `chrome.storage.sync` for settings — `~/.opentabs/config.json` on the MCP server is the sole source of truth.

### Console Logging (Security/Transparency)

Every tool invocation logs a `console.warn` in the target tab's DevTools:

```
[OpenTabs] slack.send_message invoked — https://npmjs.com/package/@opentabs/plugin-slack
[OpenTabs] my-plugin.do_thing invoked — /Users/dev/my-plugin
```

This is injected at the dispatch level by the extension — plugin authors do NOT need to add it. The link is the npm URL for published plugins or the local path for local plugins.

## Hot Reload

### MCP Server Hot Reload

The MCP server runs via `bun --hot`. When compiled output changes:
1. Modules are re-evaluated
2. Plugin tools are re-registered
3. `notifications/tools/list_changed` sent to MCP clients
4. Plugin install payloads re-sent to extension

The non-hot-reloadable surface should be as small as possible. Even the MCP server itself should be hot-reloadable for fast core team iteration.

### Plugin Hot Reload (Local Development)

For local plugins (filesystem paths), the MCP server watches for changes via `fs.watch`:

```
Plugin author saves a file
  → bun build --watch (in plugin project) runs tsc + opentabs build
  → IIFE and/or manifest change on disk
  → MCP server detects file change (fs.watch, debounced ~200ms)
  → MCP server re-reads manifest (new/changed/removed tools, updated schemas)
  → MCP server re-reads IIFE
  → MCP server re-registers MCP tools if schemas changed
  → MCP server sends plugin.update to extension via WebSocket
  → Extension re-injects updated IIFE into matching tabs (executeScript)
  → New IIFE overwrites old adapter registration
  → Next tool call uses updated code
```

**No tab reload. No extension reload. Sub-second feedback.**

File watching is ONLY for local plugins. npm-installed plugins are updated via `bun update` and MCP server restart.

### Extension Reload

For platform development (changes to extension code itself), the MCP server sends `extension.reload` via WebSocket. The extension calls `chrome.runtime.reload()`, then auto-reconnects via the offscreen document's reconnect logic. The MCP server re-sends all plugin payloads on reconnect.

## Slack Plugin — DX Acceptance Test

The Slack plugin is the first official plugin. It lives in a separate project directory (NOT a workspace member) to simulate a real third-party plugin development environment.

### Principles

1. **Separate directory, NOT a workspace member** — simulates real third-party development
2. **Uses SDK as a local file dependency during dev** — `"@opentabs/plugin-sdk": "file:../../platform/plugin-sdk"` in `package.json`. Swapped to npm version before publishing.
3. **Platform supports local plugin install** — loaded via filesystem path in `~/.opentabs/config.json`
4. **Zero platform-internal imports** — if the Slack plugin needs something the SDK doesn't provide, the SDK is wrong
5. **DX acceptance test** — any friction discovered while developing the Slack plugin must be resolved in the SDK before shipping

### Project Structure

```
opentabs/
├── platform/           # Monorepo workspaces
│   ├── plugin-sdk/
│   ├── mcp-server/
│   ├── browser-extension/
│   └── create-plugin/
└── plugins/            # NOT workspace members
    └── slack/          # file: depends on ../../platform/plugin-sdk
```

## Development Philosophy

### Autonomous Development Loop (Phase 0)

The very first thing to build and verify is the self-iteration development loop. Before any features are implemented, the platform must support fully autonomous AI-agent-driven development:

```
Edit code → Build → Hot reload (MCP server) → Reload extension (MCP tool) → Test via tools
```

**Every user story after Phase 0 should note**: "Hot reload is available for both MCP server (`bun --hot`) and extension (`extension.reload` JSON-RPC method). Use them for fast iteration."

The first Ralph (AI agent) must set up this loop manually (first extension install requires human). All subsequent Ralphs can iterate autonomously.

### Writing for Autonomous Agents (Ralph)

The PRD reader may be an autonomous AI agent with no memory of previous iterations:
- Be explicit and unambiguous
- Reference specific file paths and modules
- Each user story must be completable independently in a single context window
- Include the autonomous dev loop note in every story

## User Stories

### Phase 0: Development Infrastructure

#### US-000: Autonomous development loop
**Description:** As an AI development agent (Ralph/Claude Code), I need to modify code, build, and verify changes with zero human intervention so that development can proceed autonomously.

This story includes building the **MCP server skeleton** (WebSocket server, hot reload via `bun --hot`) and the **core Chrome extension skeleton** (background script, offscreen document, alarm-based keepalive, WebSocket auto-connect/reconnect) — enough infrastructure for the extension to connect to the MCP server and support reload commands. Full extension features (adapter injection, tool dispatch, tab state tracking) are built in US-004.

**Depends on:** None (first story — bootstraps the project)

**Acceptance Criteria:**
- [ ] MCP server runs via `bun --hot dist/index.js` and hot-reloads when compiled files change
- [ ] MCP server exposes a WebSocket server for extension connection
- [ ] `bun run build` compiles TS → JS without deleting `dist/` first (safe for hot reload)
- [ ] Hot reload sends `notifications/tools/list_changed` to all connected MCP clients
- [ ] Chrome extension skeleton built with: background script, offscreen document, alarm-based keepalive
- [ ] Offscreen document maintains persistent WebSocket connection to MCP server with auto-reconnect (exponential backoff)
- [ ] Background script routes messages between offscreen document and extension internals
- [ ] Extension reload via `extension.reload` JSON-RPC method triggers `chrome.runtime.reload()`
- [ ] Extension auto-reconnects after reload via offscreen document's WebSocket reconnect
- [ ] After MCP server hot reload: calling affected tools verifies runtime behavior
- [ ] After extension reload: extension reconnects within a few seconds
- [ ] `bun run build && bun run type-check` passes

---

### Phase 1: Core Platform

#### US-001: Plugin SDK — abstract class and defineTool
**Description:** As a plugin author, I need the `@opentabs/plugin-sdk` package with the `OpenTabsPlugin` abstract class, `defineTool()` factory, and `ToolError` class so I can write type-safe plugins.

**Depends on:** None (standalone package, no platform dependencies)

**Acceptance Criteria:**
- [ ] `OpenTabsPlugin` abstract class exported with: `name`, `version`, `description`, `urlPatterns`, `tools`, `isReady()`, optional `displayName`
- [ ] `defineTool<TInput, TOutput>()` factory exported, provides full generic type inference on `handle()` params and return type
- [ ] `ToolError` class exported with `message` and `code` fields
- [ ] Input constrained to `z.ZodObject` (MCP tool params are always objects), output is any `z.ZodType`
- [ ] All types use `import type { z } from 'zod'` — Zod is a peer dependency, not bundled
- [ ] `bun run build && bun run type-check` passes

**Dev note:** Hot reload is available for MCP server and extension after US-000 is complete.

#### US-002: MCP server — basic server with WebSocket relay
**Description:** As the platform, I need the MCP server to start, accept MCP client connections, maintain a WebSocket connection to the Chrome extension, and support hot reload.

**Depends on:** US-000 (MCP server skeleton with WebSocket and hot reload)

**Acceptance Criteria:**
- [ ] MCP server starts with `bun --hot dist/index.js`
- [ ] Accepts MCP client connections (streamable HTTP transport)
- [ ] Maintains WebSocket server for Chrome extension connection
- [ ] Sends `sync.full` JSON-RPC notification to extension on WebSocket connect
- [ ] Receives `tab.syncAll` and `tab.stateChanged` from extension, maintains tab-to-plugin mapping
- [ ] Supports `ping`/`pong` keepalive
- [ ] Health endpoint at `GET /health`
- [ ] `bun run build && bun run type-check` passes

#### US-003: Config system
**Description:** As a user, I want `~/.opentabs/config.json` created automatically on first run with sensible defaults, serving as the single source of truth for all settings.

**Depends on:** US-002 (config lives in the MCP server process)

**Acceptance Criteria:**
- [ ] `~/.opentabs/` directory created on first MCP server run if it doesn't exist
- [ ] `~/.opentabs/config.json` created with default structure: `{ "plugins": [], "tools": {} }`
- [ ] `plugins` array contains local plugin filesystem paths
- [ ] `tools` object contains per-tool enabled/disabled state: `{ "slack_send_message": true, "slack_search": false }`
- [ ] All tools of a newly installed plugin start **disabled by default**
- [ ] Disabled tools are NOT registered on the MCP server — they don't appear in the tool list
- [ ] Config changes take effect on hot reload or `config.setToolEnabled`/`config.setAllToolsEnabled` JSON-RPC calls
- [ ] File read errors (permissions, corrupt JSON) are caught — server starts with defaults
- [ ] Config is valid JSON, human-readable, and hand-editable
- [ ] `bun run build && bun run type-check` passes

#### US-004: Chrome extension — adapter injection, dispatch, tab state
**Description:** As the platform, I need the Chrome extension to handle adapter injection/dispatch and tab state tracking, building on the skeleton from US-000.

**Depends on:** US-000 (extension skeleton with WebSocket), US-002 (MCP server to communicate with)

**Acceptance Criteria:**
- [ ] On `sync.full`: stores plugin manifests + IIFEs in `chrome.storage.local`, injects adapters into matching tabs
- [ ] On `plugin.update`: stores updated IIFE, re-injects into matching tabs via `chrome.scripting.executeScript` (MAIN world)
- [ ] On `plugin.uninstall`: removes stored plugin data, unregisters from matching tabs
- [ ] On `tool.dispatch`: finds matching tab, executes tool via `chrome.scripting.executeScript`, returns result
- [ ] Tab events (`onUpdated`, `onRemoved`) push `tab.stateChanged` notifications to MCP server
- [ ] On connect/reconnect: sends `tab.syncAll` with current state
- [ ] IIFE injection must handle pages with strict CSP — the implementation should explore multiple approaches (executeScript with new Function, script element injection, declarativeNetRequest CSP modification) and use the one with least friction
- [ ] Extension declares `unlimitedStorage` permission
- [ ] `bun run build && bun run type-check` passes

#### US-005: Plugin discovery and loading
**Description:** As the platform, I need the MCP server to discover plugins from `node_modules` and local filesystem paths, read their manifests, and register MCP tools.

**Depends on:** US-001 (SDK for plugin builds), US-002 (MCP server), US-003 (config provides local paths), US-004 (extension receives install payloads)

**Acceptance Criteria:**
- [ ] Scans `node_modules` for packages matching `opentabs-plugin-*` or `@*/opentabs-plugin-*`
- [ ] Falls back to `opentabs-plugin` keyword in `package.json`
- [ ] Reads local plugin paths from `~/.opentabs/config.json`
- [ ] For each plugin: reads `opentabs-plugin.json` (manifest) and `dist/adapter.iife.js` (IIFE)
- [ ] Registers MCP tools from manifest JSON Schemas, auto-prefixing tool names with plugin name
- [ ] Validates: plugin name matches npm package name (minus `opentabs-plugin-`), URL patterns not overly broad, no reserved names
- [ ] Trust tiers: `@opentabs/` scope → official, npm → community, filesystem path → local
- [ ] Failed plugins don't crash the platform — errors logged, other plugins continue
- [ ] Sends plugin install payloads (manifest + IIFE) to extension via WebSocket
- [ ] `bun run build && bun run type-check` passes

#### US-006: Local plugin file watching
**Description:** As a plugin developer, I want the MCP server to detect when my local plugin's IIFE changes on disk and automatically re-inject the updated code into matching tabs.

**Depends on:** US-003 (config provides local paths to watch), US-004 (extension for re-injection), US-005 (plugin discovery)

**Acceptance Criteria:**
- [ ] MCP server sets up `fs.watch` on each local plugin's output directory (from `~/.opentabs/config.json` paths)
- [ ] Watches `opentabs-plugin.json` and `dist/adapter.iife.js`
- [ ] On IIFE change: re-reads IIFE, sends `plugin.update` to extension, extension re-injects into matching tabs
- [ ] On manifest change: re-reads manifest, re-registers MCP tools if schemas changed, sends `notifications/tools/list_changed`
- [ ] Debounces file change events (~200ms) to handle rapid successive writes
- [ ] File watching is ONLY for local plugins (filesystem paths), not npm-installed plugins
- [ ] `bun run build && bun run type-check` passes

---

### Phase 2: Build Tooling

Build tooling must come before the Slack plugin because the Slack plugin is scaffolded using `create-opentabs-plugin` and built using `opentabs build`.

#### US-007: `opentabs build` CLI
**Description:** As a plugin author, I need `opentabs build` to validate my plugin, generate the manifest, and bundle the IIFE — all in one command.

**Depends on:** US-001 (SDK — imports and introspects plugin class instances)

**Acceptance Criteria:**
- [ ] Imports the plugin module, reads the exported `OpenTabsPlugin` instance
- [ ] Extracts metadata: name, version, description, urlPatterns, displayName
- [ ] Extracts tool definitions: name, description, Zod input/output schemas
- [ ] Converts Zod schemas to JSON Schema
- [ ] Validates: URL patterns, reserved names, schema completeness, plugin name matches npm package name
- [ ] Writes `opentabs-plugin.json` manifest
- [ ] Bundles plugin source into `dist/adapter.iife.js` (self-contained IIFE)
- [ ] Validation errors are clear and actionable
- [ ] Extensively tested — covers all edge cases
- [ ] `bun run build && bun run type-check` passes

#### US-008: `create-opentabs-plugin` scaffolding CLI
**Description:** As a plugin developer, I want to run `bunx create-opentabs-plugin jira --domain .atlassian.net` and get a ready-to-build plugin project.

**Depends on:** US-001 (SDK — scaffolded project depends on SDK), US-007 (build CLI — scaffolded project's build script runs `opentabs build`)

**Acceptance Criteria:**
- [ ] CLI accepts: plugin name (required), `--domain`, `--display`, `--description`
- [ ] Generates: `package.json`, `tsconfig.json`, `src/index.ts` (plugin class), `src/tools/example.ts` (sample tool)
- [ ] Template includes `opentabs-plugin` keyword, correct peer dependencies, build/dev scripts
- [ ] Template uses `"@opentabs/plugin-sdk": "file:..."` local reference during development (swapped to npm version for production)
- [ ] Plugin name validation: lowercase alphanumeric + hyphens, not reserved
- [ ] Generated project builds successfully with `bun run build` (which runs `tsc && opentabs build`)
- [ ] `bun run type-check` passes

---

### Phase 3: Slack Plugin (DX Validation)

The Slack plugin is scaffolded using `create-opentabs-plugin` from Phase 2 — this is the first real-world test of the scaffolding CLI and build tooling. Any friction discovered must be fixed in the platform before continuing.

#### US-009: Slack plugin — scaffold and project setup
**Description:** As a plugin developer, I need the Slack plugin scaffolded using `create-opentabs-plugin` and set up as a standalone project, proving the end-to-end developer workflow from scaffolding to running.

**Depends on:** US-008 (scaffolding CLI), US-003 (config — local plugin path), US-005 (discovery — MCP server discovers local plugin on startup)

**Acceptance Criteria:**
- [ ] Slack plugin created via `bunx create-opentabs-plugin slack --domain .slack.com --display Slack`
- [ ] Output placed in `plugins/slack/`, NOT a workspace member of the platform monorepo
- [ ] `package.json` updated to use `"@opentabs/plugin-sdk": "file:../../platform/plugin-sdk"` (local reference for development)
- [ ] `package.json` has `"opentabs-plugin"` keyword and correct `files` array
- [ ] Build script: `"build": "tsc && opentabs build"`, Dev script: `"dev": "bun run build --watch"`
- [ ] `bun install && bun run build` succeeds — produces `opentabs-plugin.json` and `dist/adapter.iife.js`
- [ ] Plugin is added to `~/.opentabs/config.json` local plugins list
- [ ] MCP server discovers it on startup
- [ ] Any friction discovered in the scaffolding or build process is fixed in `create-opentabs-plugin` and `opentabs build` before proceeding

#### US-010: Slack plugin — isReady and core tools
**Description:** As a user, I want the Slack plugin to check authentication via `isReady()` and provide core messaging tools.

**Depends on:** US-009 (Slack plugin exists), US-004 (extension dispatches tool calls to tabs), US-006 (file watching for dev iteration)

**Acceptance Criteria:**
- [ ] `isReady()` calls `/api/auth.test` and returns `true` if `ok: true`
- [ ] Tool: `send_message` — sends a message to a channel/DM
- [ ] Tool: `read_messages` — reads recent messages from a channel
- [ ] Tool: `search_messages` — searches messages across the workspace
- [ ] Tool: `list_channels` — lists channels in the workspace
- [ ] All tools use `fetch` to call Slack's internal API (same-origin, page's cookies)
- [ ] All tools have Zod input/output schemas with `.describe()` on each field
- [ ] Error cases throw `ToolError` with Slack's error codes
- [ ] End-to-end test: MCP client → MCP server → extension → Slack tab → response
- [ ] `bun run build && bun run type-check` passes

#### US-011: Slack plugin — full tool coverage
**Description:** As a user, I want comprehensive Slack tools covering all major operations.

**Depends on:** US-010 (core tools and end-to-end flow verified)

**Acceptance Criteria:**
- [ ] Tools organized by domain: messages, conversations, channels, users, search, files, reactions, pins, stars
- [ ] Each tool has typed input/output schemas with descriptive field annotations
- [ ] All tools tested end-to-end via MCP client
- [ ] `bun run build && bun run type-check` passes

---

### Phase 4: Side Panel & Polish

#### US-012: Side panel — plugin list and tool toggles
**Description:** As a user, I want the side panel to show all plugins with their tools, and let me toggle tools on/off.

**Depends on:** US-002 (MCP server), US-003 (config for tool state), US-004 (extension background relays messages), US-005 (plugins to display)

**Acceptance Criteria:**
- [ ] React app using existing `@extension/ui` component library + Tailwind + lucide-react
- [ ] Header: OpenTabs logo, tagline, MCP connectivity indicator (green/red dot)
- [ ] Plugin list: cards grouped by plugin, showing name, version, trust tier badge, tab state indicator
- [ ] Per-plugin: enable all / disable all toggle
- [ ] Per-tool: toggle switch, tool name, description
- [ ] Toggling sends `config.setToolEnabled` / `config.setAllToolsEnabled` to MCP server
- [ ] Newly installed plugin tools shown as disabled by default
- [ ] Disconnected state: everything greyed out, "MCP server not connected" message
- [ ] Data fetched from MCP server via `config.getState` (NOT from `chrome.storage`)
- [ ] `bun run type-check` passes
- [ ] Verify in browser

#### US-013: Side panel — tab state indicators
**Description:** As a user, I want the side panel to show tab state per plugin so I know if I need to open or log in to a tab.

**Depends on:** US-012 (side panel exists with plugin cards)

**Acceptance Criteria:**
- [ ] Each plugin displays a status indicator: green (ready), yellow (unavailable), red (closed)
- [ ] `closed` state shows hint: "Open app.slack.com in your browser"
- [ ] `unavailable` state shows hint: "Log in to Slack"
- [ ] `ready` state shows no hint (clean, good state)
- [ ] Tab state updates received from background script, reflected in real time
- [ ] `bun run type-check` passes
- [ ] Verify in browser

#### US-014: Tool activity animation
**Description:** As a user, I want the side panel to show a visual indicator when a tool is being invoked.

**Depends on:** US-012 (side panel exists with tool list)

**Acceptance Criteria:**
- [ ] Side panel receives `tool.invocationStart` and `tool.invocationEnd` from background script
- [ ] Active tools show a pulse/spinner animation
- [ ] Animation clears when `tool.invocationEnd` is received
- [ ] Activity is transient — no persistent log
- [ ] `bun run type-check` passes
- [ ] Verify in browser

#### US-015: Console logging on tool invocation
**Description:** As a user, I want every plugin tool invocation to log a `console.warn` in the target tab's DevTools for transparency and security.

**Depends on:** US-004 (extension dispatch level — logging is injected during tool dispatch)

**Acceptance Criteria:**
- [ ] When the adapter receives a tool dispatch, the extension logs `console.warn` in the target tab: `[OpenTabs] slack.send_message invoked — <link>`
- [ ] Link is the npm URL for published plugins, or the local filesystem path for local plugins
- [ ] Logging is injected at the dispatch level in the extension — plugin authors do NOT add it
- [ ] The warning is minimal (one line + link) — does not log request params or response data
- [ ] `bun run type-check` passes

#### US-016: Outdated plugin check on startup
**Description:** As a user, I want the MCP server to check for newer plugin versions on startup and tell me what to run.

**Depends on:** US-005 (plugin discovery — needs to know which plugins are installed)

**Acceptance Criteria:**
- [ ] On startup, MCP server queries npm registry for each installed npm plugin's latest version (skip local plugins)
- [ ] Check is non-blocking — server startup does not wait for it
- [ ] Results logged to stdout with exact `bun update` command
- [ ] Results available to side panel via `config.getState` response
- [ ] `bun run type-check` passes

---

### Phase 5: End-to-End Verification

#### US-017: Full lifecycle verification
**Description:** As a platform developer, I want to verify the full plugin lifecycle end-to-end.

**Depends on:** US-008 (create-plugin), US-005 (discovery), US-004 (extension dispatch), US-006 (file watching), US-012 (side panel), US-015 (console logging)

**Acceptance Criteria:**
- [ ] Scaffold a test plugin with `create-opentabs-plugin`
- [ ] Build the plugin: `bun run build`
- [ ] Install locally via `~/.opentabs/config.json` path
- [ ] MCP server discovers the plugin at startup — all tools disabled by default
- [ ] Enable a tool from side panel → tool appears in MCP client tool list
- [ ] Tool invocation works end-to-end (MCP client → server → extension → adapter → web API)
- [ ] Tool invocation logs `console.warn` in target tab
- [ ] Side panel animates during tool invocation
- [ ] Disable tool from side panel → tool removed from MCP client tool list
- [ ] Code change in plugin → `bun run build` → MCP server detects → re-injects → new behavior
- [ ] `bun run build && bun run type-check` passes

## Functional Requirements

- FR-1: The plugin SDK must provide `OpenTabsPlugin` abstract class, `defineTool()` factory, and `ToolError` class — all without importing platform internals
- FR-2: Plugin distribution is via npm with `opentabs-plugin-*` naming convention and `opentabs-plugin` keyword for auto-discovery
- FR-3: Local plugin installation via filesystem paths in `~/.opentabs/config.json` uses the same code path as npm-installed plugins
- FR-4: `opentabs build` validates, generates JSON Schema from Zod, and bundles the IIFE — plugin authors never hand-author the manifest
- FR-5: The MCP server discovers, validates, and loads plugins at startup, registering MCP tools from manifest JSON Schemas
- FR-6: The MCP server routes tool calls: validate input → send to extension → receive result → validate output → return to MCP client
- FR-7: The MCP server hot-reloads via `bun --hot` without disconnecting MCP clients
- FR-8: The MCP server watches local plugin directories for changes and triggers re-injection
- FR-9: The Chrome extension stores IIFEs in `chrome.storage.local` and injects them into matching tabs via `chrome.scripting.executeScript` (MAIN world)
- FR-10: The Chrome extension pushes tab state changes to the MCP server via WebSocket (no polling)
- FR-11: All communication between MCP server and extension uses JSON-RPC 2.0
- FR-12: Tool names are auto-prefixed with the plugin name derived from the npm package name
- FR-13: All tools of a newly installed plugin are disabled by default — users must explicitly enable them
- FR-14: `~/.opentabs/config.json` is the single source of truth for all settings
- FR-15: The side panel reads state from the MCP server and sends mutations back — it does NOT own settings
- FR-16: Every tool invocation emits a `console.warn` in the target browser tab with a link to the source package
- FR-17: Tool activity events are broadcast to the extension for side panel animation
- FR-18: The Slack plugin uses zero platform-internal imports — identical SDK as community plugins
- FR-19: The autonomous development loop is the first capability verified (Phase 0)
- FR-20: Plugin adapters run in MAIN world — no Chrome API proxy or permission delegation needed
- FR-21: Tab state uses three values: `closed`, `unavailable`, `ready`
- FR-22: The MCP server checks for outdated plugins on startup (non-blocking)
- FR-23: Plugin hot reload re-injects the IIFE without reloading tabs or the extension

## Non-Goals

- **Chrome API proxy / permission delegation**: Adapters run in MAIN world with the page's own permissions. No extension API bridge.
- **Mock testing utilities**: Plugin testing uses real browsers via local install + hot reload. No mocked environments.
- **`opentabs dev` command**: Plugin authors use `bun run build --watch`. The MCP server's file watcher handles the rest.
- **Hosted plugin registry**: All distribution is via npm. No proprietary plugin server.
- **Plugin sandboxing via V8 isolates**: Security is via Chrome's content script URL matching.
- **Per-plugin settings pages**: The side panel lists tools with toggles. No per-plugin configuration UI.
- **Cross-plugin communication**: Plugins are isolated from each other.
- **Mobile or non-Chrome browser support**: Chrome (and Chromium-based browsers) only.
- **System MCP tools**: No `opentabs_reload_plugins`, `opentabs_get_config`, etc. for now.
- **Project-level config**: No `opentabs.config.ts`. Only `~/.opentabs/config.json`.
- **Plugin lifecycle hooks**: No `onInstall`/`onUninstall` — no server-side plugin code to hook into.
- **npm publishing during development**: All packages are npm-publish-ready but use local `file:` references during development. Publishing happens when the platform goes to production.

## Technical Considerations

- **Runtime**: Bun (monorepo with workspaces for platform packages). MCP server runs under `bun --hot`.
- **Build**: `tsc --build` for composite project references. Adapters compiled to IIFEs by `opentabs build`.
- **Module format**: ES Modules (`"type": "module"`) throughout.
- **Chrome Extension**: Manifest V3. Offscreen document for persistent WebSocket. Background script for routing. `unlimitedStorage` permission.
- **MCP Protocol**: `@modelcontextprotocol/sdk`. Streamable HTTP transport for MCP clients, WebSocket for Chrome extension.
- **Schema validation**: Zod in plugin source (build-time). JSON Schema in manifest (runtime). Platform never imports plugin code at runtime.
- **Config**: `~/.opentabs/config.json` — single file, JSON, human-readable.
- **Tab state**: Three states: `closed`, `unavailable`, `ready`.
- **CSP handling**: IIFE injection into MAIN world may require multiple approaches depending on page CSP. Implementation should explore `new Function()`, script element injection, and `declarativeNetRequest` CSP modification, choosing the approach with least friction.

## Stretch Goals (Documented for Future)

- npm-based plugin search page (query npm registry for `opentabs-plugin` keyword)
- GitHub template repository for plugin projects
- Plugin README badges ("Works with OpenTabs")
- Plugin validation CLI (`opentabs validate` — separate from build)
- Documentation website with API reference and guides

## Success Metrics

- **Autonomous development**: Full edit → build → verify cycle with zero human intervention (after first extension install)
- **Plugin developer DX**: `bunx create-opentabs-plugin` to working tool in under 30 minutes
- **Hot reload latency**: Under 3 seconds (MCP server) / sub-second (plugin IIFE re-injection)
- **Plugin install**: `bun add opentabs-plugin-x` + MCP server restart = tools available
- **Local plugin**: Add path to config + MCP server restart = tools available
- **Slack plugin**: Zero platform-internal imports. Uses identical SDK as community plugins.
- **Tool toggle**: Side panel toggle takes effect within 1 second
- **Tool activity**: Appears in side panel within 100ms

## Open Questions

None at this time. All design decisions have been resolved through the design interview.
