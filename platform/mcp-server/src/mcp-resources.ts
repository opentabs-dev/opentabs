/**
 * MCP resource definitions for the OpenTabs server.
 *
 * Resources are static or dynamic documents that AI clients can fetch on demand
 * via `resources/read`. Unlike instructions (sent on every session), resources
 * are pull-based — clients discover them via `resources/list` and fetch content
 * when they need deeper context.
 *
 * Static resources return pre-built markdown content (guides, references).
 * The `opentabs://status` resource is dynamic — built from ServerState at read time.
 */

import type { ServerState } from './state.js';

/** A resource definition for MCP resources/list */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** A resolved resource for MCP resources/read */
export interface ResolvedResource {
  uri: string;
  mimeType: string;
  text: string;
}

/** All registered resources */
const RESOURCES: ResourceDefinition[] = [
  {
    uri: 'opentabs://guide/quick-start',
    name: 'Quick Start Guide',
    description: 'Installation, configuration, and first tool call',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://guide/plugin-development',
    name: 'Plugin Development Guide',
    description: 'Full guide to building OpenTabs plugins (SDK, patterns, conventions)',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://guide/troubleshooting',
    name: 'Troubleshooting Guide',
    description: 'Common errors and resolution steps',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://reference/sdk-api',
    name: 'SDK API Reference',
    description: 'Plugin SDK API reference (utilities, errors, lifecycle hooks)',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://reference/cli',
    name: 'CLI Reference',
    description: 'CLI command reference (opentabs, opentabs-plugin)',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://reference/browser-tools',
    name: 'Browser Tools Reference',
    description: 'All browser tools organized by category',
    mimeType: 'text/markdown',
  },
  {
    uri: 'opentabs://status',
    name: 'Server Status',
    description: 'Live server state: loaded plugins, extension connectivity, tab states',
    mimeType: 'application/json',
  },
];

/** Resource URI → definition for O(1) lookup */
const RESOURCE_MAP = new Map(RESOURCES.map(r => [r.uri, r]));

// ---------------------------------------------------------------------------
// Static resource content
// ---------------------------------------------------------------------------

const QUICK_START_CONTENT = `# OpenTabs Quick Start Guide

## What is OpenTabs?

OpenTabs is a platform that gives AI agents access to web applications through the user's authenticated browser session. It consists of:

- **MCP Server** — runs on localhost, serves tools to AI clients via Streamable HTTP
- **Chrome Extension** — injects plugin adapters into matching browser tabs, relays tool calls
- **Plugin SDK** — allows anyone to create plugins as standalone npm packages

When connected, your AI client gets browser tools (tab management, screenshots, DOM interaction, network capture) and plugin tools (e.g., \`slack_send_message\`, \`github_list_repos\`) that operate in the user's authenticated context.

## Installation

\`\`\`bash
npm install -g @opentabs-dev/cli
\`\`\`

## Starting the Server

\`\`\`bash
opentabs start
\`\`\`

On first run, this:
1. Creates \`~/.opentabs/\` (config, logs, extension files)
2. Generates a WebSocket auth secret at \`~/.opentabs/extension/auth.json\`
3. Prints MCP client configuration blocks for Claude Code, Cursor, and Windsurf
4. Starts the MCP server on \`http://127.0.0.1:9515/mcp\`

To re-display the configuration blocks later:

\`\`\`bash
opentabs start --show-config
\`\`\`

## Loading the Chrome Extension

1. Open \`chrome://extensions/\` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select \`~/.opentabs/extension\`

The extension icon appears in the toolbar. Click it to open the side panel showing plugin states and tool permissions.

## Configuring Your MCP Client

Get the auth secret:

\`\`\`bash
opentabs config show --json --show-secret | jq -r .secret
\`\`\`

### Claude Code

CLI method (recommended):

\`\`\`bash
claude mcp add --transport http opentabs http://127.0.0.1:9515/mcp \\
  --header "Authorization: Bearer YOUR_SECRET_HERE"
\`\`\`

Or merge into \`~/.claude.json\`:

\`\`\`json
{
  "mcpServers": {
    "opentabs": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:9515/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
\`\`\`

### Cursor

Add to \`.cursor/mcp.json\`:

\`\`\`json
{
  "mcpServers": {
    "opentabs": {
      "type": "http",
      "url": "http://127.0.0.1:9515/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
\`\`\`

### Windsurf

Add to \`~/.codeium/windsurf/mcp_config.json\`:

\`\`\`json
{
  "mcpServers": {
    "opentabs": {
      "serverUrl": "http://127.0.0.1:9515/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
\`\`\`

### OpenCode

Add to \`opencode.json\` in the project root:

\`\`\`json
{
  "mcp": {
    "opentabs": {
      "type": "remote",
      "url": "http://127.0.0.1:9515/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
\`\`\`

## Installing a Plugin

\`\`\`bash
opentabs plugin search              # Browse available plugins
opentabs plugin install <name>      # Install (e.g., opentabs plugin install slack)
\`\`\`

After installing, open the target web app in Chrome (e.g., \`app.slack.com\` for Slack). The extension detects the matching tab and loads the plugin adapter.

## Plugin Review Flow

Plugins start with permission \`'off'\` and must be reviewed before use. When you call a tool on an unreviewed plugin, the error response guides you through the review:

1. Call \`plugin_inspect\` with the plugin name to retrieve the adapter source code and a review token
2. Review the code for security (the response includes review guidance)
3. If the code is safe, call \`plugin_mark_reviewed\` with the review token and desired permission (\`'ask'\` or \`'auto'\`)
4. The plugin is now active — its tools are available

When a plugin updates to a new version, its permission resets to \`'off'\` and requires re-review.

## Permission Model

Every tool has a 3-state permission:

| Permission | Behavior |
|------------|----------|
| \`'off'\` | Disabled — tool call returns an error |
| \`'ask'\` | Requires human approval via the side panel dialog |
| \`'auto'\` | Executes immediately without user confirmation |

Configure permissions via CLI:

\`\`\`bash
opentabs config set plugin-permission.<plugin> ask
opentabs config set tool-permission.<plugin>.<tool> auto
\`\`\`

To bypass all permission checks (development only):

\`\`\`bash
OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS=1 opentabs start
\`\`\`

## Available Tool Categories

### Plugin Tools (\`<plugin>_<tool>\`)
Execute inside the web page context using the user's authenticated browser session. Each plugin exposes domain-specific tools (e.g., \`slack_send_message\`, \`github_create_issue\`).

### Browser Tools (\`browser_*\`) — 40 built-in tools
General-purpose tools organized by category:
- **Tab Management** — open, close, list, switch tabs
- **Content Retrieval** — read page content, HTML, take screenshots
- **DOM Interaction** — click elements, type text, query selectors
- **Scroll & Navigation** — scroll, navigate, go back/forward
- **Storage & Cookies** — read/write localStorage, sessionStorage, cookies
- **Network Capture** — capture and inspect network requests, WebSocket frames, HAR export
- **Console** — read browser console logs
- **Site Analysis** — comprehensive analysis of a web page for plugin development

### Extension Tools (\`extension_*\`)
Diagnostics: extension state, logs, adapter injection status, WebSocket connectivity.

## Multi-Tab Targeting

When multiple tabs match a plugin, use \`plugin_list_tabs\` to discover available tabs and their IDs. Pass the optional \`tabId\` parameter to any plugin tool to target a specific tab. Without \`tabId\`, the platform auto-selects the best-ranked tab.

## Verifying the Setup

\`\`\`bash
opentabs status    # Check server, extension, and plugin status
opentabs doctor    # Run diagnostics and suggest fixes
\`\`\`

From your AI client, you can also:
1. Fetch \`opentabs://status\` to get a JSON snapshot of the server state
2. Call \`extension_get_state\` to verify the Chrome extension is connected
3. Call \`plugin_list_tabs\` to see which plugin tabs are ready
`;

const PLUGIN_DEVELOPMENT_CONTENT = `# Plugin Development Guide

## Architecture

OpenTabs plugins run **in the browser page context**, not on the server. The MCP server discovers plugins, but tool execution happens inside the web page via an adapter IIFE injected by the Chrome extension. This means plugin code has full access to the page's DOM, JavaScript globals, cookies, localStorage, and authenticated fetch requests.

**Flow:** AI client → MCP server → Chrome extension (WebSocket) → adapter IIFE (page context) → tool handler → result back through the chain.

## Plugin Structure

A plugin is a standalone npm package with this structure:

\`\`\`
my-plugin/
├── package.json         # Must include "opentabs" field
├── src/
│   ├── plugin.ts        # OpenTabsPlugin subclass (entry point)
│   └── tools/
│       ├── get-data.ts  # One file per tool (convention)
│       └── send-msg.ts
├── dist/                # Built by opentabs-plugin build
│   ├── adapter.iife.js  # Injected into matching browser tabs
│   └── tools.json       # Tool schemas for MCP registration
└── tsconfig.json
\`\`\`

### package.json

\`\`\`json
{
  "name": "@scope/opentabs-plugin-myapp",
  "version": "1.0.0",
  "opentabs": {
    "name": "myapp",
    "displayName": "My App",
    "description": "Tools for My App",
    "urlPatterns": ["*://myapp.com/*"]
  },
  "main": "src/plugin.ts",
  "scripts": {
    "build": "opentabs-plugin build"
  },
  "dependencies": {
    "@opentabs-dev/plugin-sdk": "latest"
  },
  "devDependencies": {
    "@opentabs-dev/plugin-tools": "latest"
  }
}
\`\`\`

The \`opentabs.name\` field is the plugin identifier (lowercase, alphanumeric + hyphens). It becomes the tool name prefix (e.g., \`myapp_get_data\`).

## OpenTabsPlugin Base Class

Every plugin extends \`OpenTabsPlugin\` and exports an instance:

\`\`\`typescript
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { getDataTool } from './tools/get-data.js';
import { sendMsgTool } from './tools/send-msg.js';

class MyPlugin extends OpenTabsPlugin {
  readonly name = 'myapp';
  readonly displayName = 'My App';
  readonly description = 'Tools for My App';
  readonly urlPatterns = ['*://myapp.com/*'];
  readonly tools: ToolDefinition[] = [getDataTool, sendMsgTool];

  async isReady(): Promise<boolean> {
    // Return true when the user is authenticated and the app is loaded
    return document.querySelector('.logged-in-indicator') !== null;
  }
}

export default new MyPlugin();
\`\`\`

### Required Members

| Member | Type | Purpose |
|--------|------|---------|
| \`name\` | \`string\` | Unique identifier (lowercase alphanumeric + hyphens) |
| \`displayName\` | \`string\` | Human-readable name shown in side panel |
| \`description\` | \`string\` | Brief plugin description |
| \`urlPatterns\` | \`string[]\` | Chrome match patterns for tab injection |
| \`tools\` | \`ToolDefinition[]\` | Array of tool definitions |
| \`isReady()\` | \`() => Promise<boolean>\` | Readiness probe — returns true when tab is ready for tool calls |

### Tab State Machine

| State | Condition |
|-------|-----------|
| \`closed\` | No browser tab matches the plugin's URL patterns |
| \`unavailable\` | Tab matches URL patterns but \`isReady()\` returns false |
| \`ready\` | Tab matches URL patterns and \`isReady()\` returns true |

## defineTool Factory

Each tool is defined with \`defineTool\`, which provides type inference:

\`\`\`typescript
import { z } from 'zod';
import { defineTool, fetchJSON } from '@opentabs-dev/plugin-sdk';
import type { ToolHandlerContext } from '@opentabs-dev/plugin-sdk';

export const getDataTool = defineTool({
  name: 'get_data',
  displayName: 'Get Data',
  description: 'Retrieves data from the app. Returns the matching records.',
  summary: 'Retrieve app data',
  icon: 'database',
  group: 'Data',
  input: z.object({
    query: z.string().describe('Search query string'),
    limit: z.number().int().min(1).max(100).default(25).describe('Max results to return'),
  }),
  output: z.object({
    results: z.array(z.object({
      id: z.string(),
      title: z.string(),
    })),
    total: z.number(),
  }),
  async handle(params, context?: ToolHandlerContext) {
    const data = await fetchJSON<{ items: Array<{ id: string; title: string }>; total: number }>(
      \`/api/data?q=\${encodeURIComponent(params.query)}&limit=\${params.limit}\`
    );
    return { results: data?.items ?? [], total: data?.total ?? 0 };
  },
});
\`\`\`

### ToolDefinition Fields

| Field | Required | Description |
|-------|----------|-------------|
| \`name\` | Yes | Tool name (auto-prefixed with plugin name) |
| \`displayName\` | No | Human-readable name for side panel (auto-derived from name if omitted) |
| \`description\` | Yes | Shown to AI agents — be specific and include return value info |
| \`summary\` | No | Short UI summary (falls back to description) |
| \`icon\` | No | Lucide icon name in kebab-case (defaults to \`wrench\`) |
| \`group\` | No | Visual grouping in the side panel |
| \`input\` | Yes | Zod object schema for parameters |
| \`output\` | Yes | Zod schema for return value |
| \`handle\` | Yes | Async function — runs in page context. Second arg is optional \`ToolHandlerContext\` |

### Progress Reporting

Long-running tools can report progress via the optional \`context\` parameter:

\`\`\`typescript
async handle(params, context?: ToolHandlerContext) {
  const items = await getItemList();
  for (let i = 0; i < items.length; i++) {
    context?.reportProgress({ progress: i + 1, total: items.length, message: \`Processing \${items[i].name}\` });
    await processItem(items[i]);
  }
  return { processed: items.length };
}
\`\`\`

## SDK Utilities Reference

All utilities are imported from \`@opentabs-dev/plugin-sdk\`. They run in the page context.

### DOM

| Function | Signature | Description |
|----------|-----------|-------------|
| \`waitForSelector\` | \`<T extends Element>(selector, opts?) → Promise<T>\` | Waits for element to appear (MutationObserver, default 10s timeout) |
| \`waitForSelectorRemoval\` | \`(selector, opts?) → Promise<void>\` | Waits for element to be removed (default 10s timeout) |
| \`querySelectorAll\` | \`<T extends Element>(selector) → T[]\` | Returns real array instead of NodeList |
| \`getTextContent\` | \`(selector) → string \\| null\` | Trimmed textContent of first match |
| \`observeDOM\` | \`(selector, callback, opts?) → () => void\` | MutationObserver on element, returns cleanup function |

### Fetch

All fetch utilities use \`credentials: 'include'\` to leverage the page's authenticated session.

| Function | Signature | Description |
|----------|-----------|-------------|
| \`fetchFromPage\` | \`(url, init?) → Promise<Response>\` | Fetch with session cookies, 30s timeout, ToolError on non-ok |
| \`fetchJSON\` | \`<T>(url, init?, schema?) → Promise<T>\` | Fetch + JSON parse. Optional Zod schema validation |
| \`postJSON\` | \`<T>(url, body, init?, schema?) → Promise<T>\` | POST with JSON body + parse response |
| \`putJSON\` | \`<T>(url, body, init?, schema?) → Promise<T>\` | PUT with JSON body + parse response |
| \`patchJSON\` | \`<T>(url, body, init?, schema?) → Promise<T>\` | PATCH with JSON body + parse response |
| \`deleteJSON\` | \`<T>(url, init?, schema?) → Promise<T>\` | DELETE + parse response |
| \`postForm\` | \`<T>(url, body, init?, schema?) → Promise<T>\` | POST URL-encoded form (Record<string,string>) |
| \`postFormData\` | \`<T>(url, body, init?, schema?) → Promise<T>\` | POST multipart/form-data (FormData) |

### Storage

| Function | Signature | Description |
|----------|-----------|-------------|
| \`getLocalStorage\` | \`(key) → string \\| null\` | Safe localStorage read (null on SecurityError) |
| \`setLocalStorage\` | \`(key, value) → void\` | Safe localStorage write |
| \`removeLocalStorage\` | \`(key) → void\` | Safe localStorage remove |
| \`getSessionStorage\` | \`(key) → string \\| null\` | Safe sessionStorage read |
| \`setSessionStorage\` | \`(key, value) → void\` | Safe sessionStorage write |
| \`removeSessionStorage\` | \`(key) → void\` | Safe sessionStorage remove |
| \`getCookie\` | \`(name) → string \\| null\` | Parse cookie by name from document.cookie |

### Page State

| Function | Signature | Description |
|----------|-----------|-------------|
| \`getPageGlobal\` | \`(path) → unknown\` | Safe deep property access on globalThis via dot-notation |
| \`getCurrentUrl\` | \`() → string\` | Returns window.location.href |
| \`getPageTitle\` | \`() → string\` | Returns document.title |

### Timing

| Function | Signature | Description |
|----------|-----------|-------------|
| \`retry\` | \`<T>(fn, opts?) → Promise<T>\` | Retry with configurable attempts (3), delay (1s), backoff, AbortSignal |
| \`sleep\` | \`(ms, opts?) → Promise<void>\` | Promisified setTimeout with optional AbortSignal |
| \`waitUntil\` | \`(predicate, opts?) → Promise<void>\` | Poll predicate at interval (200ms) until true, timeout (10s) |

### Logging

| Function | Description |
|----------|-------------|
| \`log.debug(message, ...args)\` | Debug level |
| \`log.info(message, ...args)\` | Info level |
| \`log.warn(message, ...args)\` | Warning level |
| \`log.error(message, ...args)\` | Error level |

Log entries flow from the page context through the extension to the MCP server and connected clients. Falls back to \`console\` methods outside the adapter runtime.

## ToolError Factories

Use static factory methods for structured errors. The dispatch chain propagates metadata (category, retryable, retryAfterMs) to AI clients.

| Factory | Signature | Category | Retryable |
|---------|-----------|----------|-----------|
| \`ToolError.auth\` | \`(message, code?) → ToolError\` | \`auth\` | No |
| \`ToolError.notFound\` | \`(message, code?) → ToolError\` | \`not_found\` | No |
| \`ToolError.rateLimited\` | \`(message, retryAfterMs?, code?) → ToolError\` | \`rate_limit\` | Yes |
| \`ToolError.validation\` | \`(message, code?) → ToolError\` | \`validation\` | No |
| \`ToolError.timeout\` | \`(message, code?) → ToolError\` | \`timeout\` | Yes |
| \`ToolError.internal\` | \`(message, code?) → ToolError\` | \`internal\` | No |

\`\`\`typescript
import { ToolError, fetchJSON } from '@opentabs-dev/plugin-sdk';

// Auth errors are automatically thrown by fetchJSON on 401/403
// For manual auth checks:
const token = getPageGlobal('app.auth.token') as string | undefined;
if (!token) throw ToolError.auth('User is not logged in');

// For domain-specific errors with custom codes:
throw ToolError.notFound('Channel not found', 'CHANNEL_NOT_FOUND');
throw ToolError.rateLimited('Slow down', 5000, 'SLACK_RATE_LIMITED');
\`\`\`

## Zod Schema Rules

Schemas are serialized to JSON Schema via \`z.toJSONSchema()\` for MCP registration. Follow these rules:

1. **Never use \`.transform()\`** — transforms cannot be represented in JSON Schema. Normalize input in the handler.
2. **Avoid \`.pipe()\`, \`.preprocess()\`, and effects** — these are runtime-only and break serialization.
3. **\`.refine()\` callbacks must never throw** — Zod 4 runs refine even on invalid base values. Wrap throwing code in try-catch.
4. **Use \`.describe()\` on every field** — descriptions are shown to AI agents in the tool schema.
5. **Keep schemas declarative** — primitives, objects, arrays, unions, literals, enums, optional, default.

## Lifecycle Hooks

Optional methods on \`OpenTabsPlugin\` — implement only what you need:

| Hook | Signature | When Called |
|------|-----------|------------|
| \`onActivate\` | \`() → void\` | After adapter registered on \`globalThis.__openTabs.adapters\` |
| \`onDeactivate\` | \`() → void\` | Before adapter removal (fires before \`teardown\`) |
| \`onNavigate\` | \`(url: string) → void\` | On in-page URL changes (pushState, replaceState, popstate, hashchange) |
| \`onToolInvocationStart\` | \`(toolName: string) → void\` | Before each \`tool.handle()\` |
| \`onToolInvocationEnd\` | \`(toolName: string, success: boolean, durationMs: number) → void\` | After each \`tool.handle()\` |
| \`teardown\` | \`() → void\` | Before re-injection on plugin update |

Errors in hooks are caught and logged — they do not affect tool execution.

## isReady() Polling Pattern

The extension polls \`isReady()\` to determine tab state. Common patterns:

\`\`\`typescript
// DOM-based: check for a logged-in indicator
async isReady(): Promise<boolean> {
  return document.querySelector('[data-testid="user-menu"]') !== null;
}

// Global-based: check for auth token in window globals
async isReady(): Promise<boolean> {
  return getPageGlobal('app.auth.token') !== undefined;
}

// API-based: verify session with a lightweight request
async isReady(): Promise<boolean> {
  try {
    await fetchJSON('/api/me');
    return true;
  } catch {
    return false;
  }
}
\`\`\`

## Auth Token Extraction

Plugins extract auth from the page — never ask users for credentials.

\`\`\`typescript
// From window globals (Slack pattern)
const token = getPageGlobal('TS.boot_data.api_token') as string | undefined;
if (!token) throw ToolError.auth('Not logged in');

// From localStorage
const token = getLocalStorage('auth_token');
if (!token) throw ToolError.auth('No auth token found');

// From cookies (session-based auth)
const session = getCookie('session_id');
if (!session) throw ToolError.auth('No session cookie');

// Cache on globalThis to avoid repeated extraction
const CACHE_KEY = '__opentabs_myapp_token';
function getToken(): string {
  const cached = (globalThis as Record<string, unknown>)[CACHE_KEY] as string | undefined;
  if (cached) return cached;
  const token = getPageGlobal('app.token') as string | undefined;
  if (!token) throw ToolError.auth('Not authenticated');
  (globalThis as Record<string, unknown>)[CACHE_KEY] = token;
  return token;
}
\`\`\`

## Build and Test Workflow

\`\`\`bash
# Build the plugin (generates dist/adapter.iife.js and dist/tools.json)
npx opentabs-plugin build
# Or if installed globally:
opentabs-plugin build

# The build command notifies the running MCP server via POST /reload
# No server restart needed — plugin changes are picked up automatically
\`\`\`

### Testing During Development

1. Build the plugin: \`opentabs-plugin build\`
2. Open the target web app in Chrome
3. Verify plugin loaded: call \`plugin_list_tabs\` from your AI client
4. Test a tool: call any plugin tool (e.g., \`myapp_get_data\`)
5. Check logs: call \`extension_get_logs\` to see adapter injection and tool execution logs

### Scaffolding a New Plugin

\`\`\`bash
npx @opentabs-dev/create-plugin
# Or with the CLI installed:
opentabs plugin create
\`\`\`

## Publishing to npm

\`\`\`json
{
  "name": "@scope/opentabs-plugin-myapp",
  "opentabs": {
    "name": "myapp",
    "displayName": "My App",
    "description": "Tools for My App",
    "urlPatterns": ["*://myapp.com/*"]
  }
}
\`\`\`

Package naming convention: \`opentabs-plugin-<name>\` or \`@scope/opentabs-plugin-<name>\`. The MCP server auto-discovers packages matching these patterns in global node_modules.

\`\`\`bash
npm publish
# Users install with:
opentabs plugin install myapp
\`\`\`

## Common Patterns

### API Wrapper

\`\`\`typescript
const API_BASE = '/api/v1';

async function apiGet<T>(path: string): Promise<T> {
  const result = await fetchJSON<T>(\`\${API_BASE}\${path}\`);
  if (result === undefined) throw ToolError.internal(\`Unexpected empty response from \${path}\`);
  return result;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const result = await postJSON<T>(\`\${API_BASE}\${path}\`, body);
  if (result === undefined) throw ToolError.internal(\`Unexpected empty response from \${path}\`);
  return result;
}
\`\`\`

### Waiting for App State

\`\`\`typescript
import { waitForSelector, waitUntil, getPageGlobal } from '@opentabs-dev/plugin-sdk';

// Wait for the app to finish loading before executing
await waitForSelector('.app-loaded');

// Wait for a specific global to be set
await waitUntil(() => getPageGlobal('app.initialized') === true);
\`\`\`

### Retrying Flaky Operations

\`\`\`typescript
import { retry, ToolError } from '@opentabs-dev/plugin-sdk';

const result = await retry(
  () => fetchJSON<Data>('/api/flaky-endpoint'),
  { maxAttempts: 3, delay: 1000, backoff: true }
);
\`\`\`
`;

/** URI → content for static resources that have been written */
const CONTENT_MAP = new Map<string, string>([
  ['opentabs://guide/quick-start', QUICK_START_CONTENT],
  ['opentabs://guide/plugin-development', PLUGIN_DEVELOPMENT_CONTENT],
]);

/** Return all resource definitions for resources/list */
export const getAllResources = (_state: ServerState): ResourceDefinition[] =>
  RESOURCES.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  }));

/**
 * Resolve a resource by URI, returning its content.
 * Returns null if the URI is not recognized.
 */
export const resolveResource = (state: ServerState, uri: string): ResolvedResource | null => {
  const def = RESOURCE_MAP.get(uri);
  if (!def) return null;

  if (uri === 'opentabs://status') {
    return { uri, mimeType: 'application/json', text: buildStatusResource(state) };
  }

  const content = CONTENT_MAP.get(uri);
  if (content) {
    return { uri, mimeType: def.mimeType, text: content };
  }

  // Static resources without content yet return a placeholder
  return { uri, mimeType: def.mimeType, text: `# ${def.name}\n\nContent coming soon.` };
};

/** Build the dynamic status resource JSON from server state */
const buildStatusResource = (state: ServerState): string => {
  const plugins = [...state.registry.plugins.values()].map(p => ({
    name: p.name,
    displayName: p.displayName,
    toolCount: p.tools.length,
    tools: p.tools.map(t => `${p.name}_${t.name}`),
    tabState: state.tabMapping.get(p.name)?.state ?? 'closed',
    tabs: (state.tabMapping.get(p.name)?.tabs ?? []).map(t => ({
      tabId: t.tabId,
      url: t.url,
      title: t.title,
      ready: t.ready,
    })),
  }));

  return JSON.stringify(
    {
      extensionConnected: state.extensionWs !== null,
      plugins,
      failedPlugins: [...state.registry.failures],
      browserToolCount: state.cachedBrowserTools.length,
      pluginToolCount: [...state.registry.plugins.values()].reduce((sum, p) => sum + p.tools.length, 0),
      skipPermissions: state.skipPermissions,
      uptime: Math.round((Date.now() - state.startedAt) / 1000),
    },
    null,
    2,
  );
};
