# Build Plugin — Full Development Workflow

Build a production-ready OpenTabs plugin for `<target-url>`.

Follow the complete workflow below. Each phase builds on the previous one — do not skip phases.

---

## Prerequisites

- The user has the target web app open in a browser tab at `<target-url>`
- The MCP server is running (you are connected to it)
- You have access to the filesystem for creating plugin source files

### Browser Tool Permissions

Plugin development requires heavy use of browser tools (`browser_execute_script`, `browser_navigate_tab`, `browser_get_tab_content`, etc.). By default, tools have permission `'off'` (disabled) or `'ask'` (requires human approval).

Ask the user if they want to enable `skipPermissions` to bypass approval prompts during development. Set the env var: `OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS=1`. Warn them this bypasses human approval and should only be used during active plugin development.

---

## Core Principle: Use the Real APIs, Never the DOM

Every plugin tool must use the web app's own APIs — the same HTTP endpoints, WebSocket channels, or internal RPC methods that the web app's JavaScript calls. DOM scraping is never acceptable as a tool implementation strategy. It is fragile (breaks on any UI change), limited (cannot access data not rendered on screen), and slow (parsing HTML is orders of magnitude slower than a JSON API call).

When an API is hard to discover, spend time reverse-engineering it (network capture, XHR interception, source code reading). Do not fall back to DOM scraping because it is faster to implement.

**Only three uses of the DOM are acceptable:**
1. `isReady()` — checking authentication signals (meta tags, page globals, indicator cookies)
2. URL hash navigation — triggering client-side route changes
3. Last-resort compose flows — when the app has no API for creating content and the UI is the only path (rare)

---

## Phase 1: Research the Codebase

Before writing any code, study the existing plugin infrastructure using the filesystem:

1. **Study the Plugin SDK** — read `platform/plugin-sdk/CLAUDE.md` and key source files (`src/index.ts`, `src/plugin.ts`, `src/tool.ts`). Understand:
   - `OpenTabsPlugin` abstract base class (name, displayName, description, urlPatterns, tools, isReady)
   - `defineTool({ name, displayName, description, icon, input, output, handle })` factory
   - `ToolError` static factories: `.auth()`, `.notFound()`, `.rateLimited()`, `.timeout()`, `.validation()`, `.internal()`
   - SDK utilities: `fetchJSON`, `postJSON`, `getLocalStorage`, `waitForSelector`, `retry`, `sleep`, `log`
   - All plugin code runs in the **browser page context** (not server-side)

2. **Study an existing plugin** (e.g., `plugins/slack/`) as the canonical reference:
   - `src/index.ts` — plugin class, imports all tools
   - `src/slack-api.ts` — API wrapper with auth extraction + error classification
   - `src/tools/` — one file per tool, shared schemas
   - `package.json` — the opentabs field, dependency versions, scripts

3. **Study `plugins/CLAUDE.md`** — plugin isolation rules and conventions

---

## Phase 2: Explore the Target Web App

This is the most critical phase. Use browser tools to understand how the web app works.

### Step 1: Find the Tab

```
plugin_list_tabs  or  browser_list_tabs  →  find the tab for <target-url>
```

### Step 2: Analyze the Site

```
plugin_analyze_site(url: "<target-url>")
```

This gives you a comprehensive report: auth methods, API endpoints, framework detection, storage keys, and concrete tool suggestions.

### Step 3: Enable Network Capture and Explore

```
browser_enable_network_capture(tabId, urlFilter: "/api")
```

Navigate around in the app to trigger API calls, then read them:

```
browser_get_network_requests(tabId)
```

Study the captured traffic to understand:
- API base URL
- Whether the API is same-origin or cross-origin (critical for CORS)
- Request format (JSON body vs form-encoded)
- Required headers (content-type, custom headers)
- Response shapes for each endpoint
- Error response format

### Step 4: Check CORS Policy (for Cross-Origin APIs)

If the API is on a different subdomain, verify CORS behavior:

```bash
curl -sI -X OPTIONS https://api.example.com/endpoint \
  -H "Origin: <target-url>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  | grep -i "access-control"
```

### Step 5: Discover Auth Token

**First, always check cookies with `browser_get_cookies`** to understand the auth model. Then probe the page:

- **localStorage**: Direct access or iframe fallback if the app deletes `window.localStorage`
- **Page globals**: `window.__APP_STATE__`, `window.boot_data`, `window.__NEXT_DATA__`
- **Webpack module stores**: For React/webpack SPAs
- **Cookies**: `document.cookie` for non-HttpOnly tokens
- **Script tags**: Inline `<script>` tags with embedded config

### Step 6: Test the API

Once you have the token, make a test API call with `browser_execute_script`:

```javascript
const resp = await fetch('https://example.com/api/v2/me', {
  headers: { Authorization: 'Bearer ' + token },
  credentials: 'include',
});
const data = await resp.json();
return data;
```

### Step 7: Intercept Internal API Traffic (for apps without clean REST APIs)

Some web apps do not expose clean REST or GraphQL APIs. Instead they use internal RPC endpoints, obfuscated paths, or proprietary protocols that are hard to discover via network capture alone. For these apps, monkey-patch `XMLHttpRequest` and `fetch` to intercept all API traffic and capture auth headers at runtime.

Install the interceptor at adapter load time to capture auth tokens from early boot requests. Store captured data on `globalThis` so it survives adapter re-injection.

```javascript
// XHR interceptor — captures internal API requests and auth headers
const captured = { authHeader: null, requests: [] };

const origOpen = XMLHttpRequest.prototype.open;
const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const origSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url) {
  this._method = method;
  this._url = url;
  return origOpen.apply(this, arguments);
};

XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (/auth|token|x-api|x-csrf/i.test(name)) {
    captured.authHeader = { name, value };
  }
  return origSetHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function (body) {
  captured.requests.push({ method: this._method, url: this._url });
  return origSend.apply(this, arguments);
};
```

Use this when:
- The app uses internal RPC endpoints not visible in standard network capture
- Auth tokens are computed by obfuscated JavaScript and cannot be extracted from storage
- You need to discover which headers the app sends on its own API calls

### Step 8: Map the API Surface

Discover the key endpoints: user/profile, list resources, get single resource, create/update/delete, search, messaging, reactions.

---

## Phase 3: Scaffold the Plugin

```bash
cd plugins/
opentabs plugin create <name> --domain <domain> --display <DisplayName> --description "OpenTabs plugin for <DisplayName>"
```

After scaffolding, compare `package.json` with an existing plugin (e.g., `plugins/slack/package.json`) and align:
- Package name: `@opentabs-dev/opentabs-plugin-<name>` for official plugins
- Version: Match the current platform version
- Add: `publishConfig`, `check` script
- Dependency versions: Match `@opentabs-dev/plugin-sdk` and `@opentabs-dev/plugin-tools` versions

---

## Phase 4: Design the Tool Set

**Maximize API coverage.** Add as many tools as the API supports. A typical production plugin has 15-25+ tools across these categories:

- **Content**: send, edit, delete, read/list, search
- **Resources/Containers**: list, get info, create, update, delete
- **Users/Members**: list, get profile
- **Interactions**: reactions, pins, bookmarks
- **Platform-specific**: threads, DMs, file uploads, etc.

For each API resource, ask: can the user list it, get one, create one, update one, delete one, and search it? If the API supports it, add the tool.

---

## Phase 5: Implement

### File Structure

```
src/
  index.ts              # Plugin class — imports all tools, implements isReady()
  <name>-api.ts         # API wrapper — auth extraction + error classification
  tools/
    schemas.ts          # Shared Zod schemas + defensive mappers
    send-message.ts     # One file per tool
    ...
```

### API Wrapper Pattern (`<name>-api.ts`)

The API wrapper handles auth extraction, request construction, and error classification:

```typescript
import { ToolError } from '@opentabs-dev/plugin-sdk';

interface AppAuth {
  token: string;
}

const getAuth = (): AppAuth | null => {
  // Check globalThis persistence first (survives adapter re-injection)
  // Then try localStorage, page globals, cookies
  // Return null if not authenticated
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise((resolve) => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isAuthenticated()) { clearInterval(timer); resolve(true); return; }
      if (elapsed >= maxWait) { clearInterval(timer); resolve(false); }
    }, interval);
  });

export const api = async <T extends Record<string, unknown>>(
  endpoint: string,
  options: { method?: string; body?: Record<string, unknown>; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  let url = `https://example.com/api${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET', headers, body: fetchBody,
      credentials: 'include', signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    throw new ToolError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      'network_error', { category: 'internal', retryable: true },
    );
  }

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) throw ToolError.rateLimited(`Rate limited: ${endpoint}`);
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
```

### Tool Pattern (one file per tool)

```typescript
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../<name>-api.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description: 'Send a message to a channel. Supports markdown formatting.',
  summary: 'Send a message to a channel',
  icon: 'send',
  input: z.object({
    channel: z.string().describe('Channel ID to send the message to'),
    content: z.string().describe('Message text content'),
  }),
  output: z.object({
    id: z.string().describe('Message ID'),
  }),
  handle: async (params) => {
    const data = await api<Record<string, unknown>>(
      '/channels/' + params.channel + '/messages',
      { method: 'POST', body: { content: params.content } },
    );
    return { id: (data.id as string) ?? '' };
  },
});
```

### Plugin Class Pattern (`index.ts`)

```typescript
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './<name>-api.js';
import { sendMessage } from './tools/send-message.js';

class MyPlugin extends OpenTabsPlugin {
  readonly name = '<name>';
  readonly description = 'OpenTabs plugin for <DisplayName>';
  override readonly displayName = '<DisplayName>';
  readonly urlPatterns = ['*://*.example.com/*'];
  readonly tools: ToolDefinition[] = [sendMessage];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new MyPlugin();
```

---

## Phase 6: Build and Test

### Build

```bash
cd plugins/<name>
npm install
npm run build
```

### Full Check Suite

```bash
npm run check  # build + type-check + lint + format:check
```

**Every command must exit 0.** Fix any failures before proceeding.

### Mandatory Tool Verification

**The plugin is not done until every tool has been called against the live browser.** Tools that have not been verified may have wrong field mappings, broken endpoints, or incorrect response parsing.

1. **Verify plugin loaded**: `plugin_list_tabs(plugin: "<name>")` — must show `state: "ready"`
2. **Call every read-only tool** (list, get, search) — verify response contains real data with correct field mappings
3. **Call every write tool** with round-trip tests (create → verify → delete → verify)
4. **Test error classification** — call a tool with an invalid ID, verify `ToolError.notFound` is returned
5. **Fix every failure** — use `browser_execute_script` to inspect raw API responses and fix mappers

**A plugin with untested tools is worse than a plugin with fewer tools.** Remove tools you cannot verify rather than shipping them broken.

---

## Key Conventions

- **One file per tool** in `src/tools/`
- **Every Zod field gets `.describe()`** — this is what AI agents see in the tool schema
- **`description` is for AI clients** — detailed, informative. `summary` is for humans — short, under 80 chars
- **Defensive mapping** with fallback defaults (`data.field ?? ''`) — never trust API shapes
- **Error classification is critical** — use `ToolError` factories, never throw raw errors
- **`credentials: 'include'`** on all fetch calls
- **30-second timeout** via `AbortSignal.timeout(30_000)`
- **`.js` extension** on all imports (ESM requirement)
- **No `.transform()`/`.pipe()`/`.preprocess()`** in Zod schemas (breaks JSON Schema serialization)

---

## Common Gotchas

1. **All plugin code runs in the browser** — no Node.js APIs
2. **SPAs hydrate asynchronously** — `isReady()` must poll (500ms interval, 5s max)
3. **Some apps delete browser APIs** — use iframe fallback for `localStorage`
4. **Tokens must persist on `globalThis.__openTabs.tokenCache.<pluginName>`** — module-level variables reset on extension reload
5. **HttpOnly cookies are invisible to plugin code** — use `credentials: 'include'` for the browser to send them automatically, detect auth status from DOM signals
6. **Parse error response bodies before classifying by HTTP status** — many apps reuse 403 for both auth and permission errors
7. **Cross-origin API + cookies: check CORS before choosing fetch strategy**
8. **Always run `npm run format` after writing code** — Biome config uses single quotes
9. **Adapter injection timing** — adapters are injected at `loading` (before page JS runs) and `complete` (after full load). `isReady()` is called at both points. Cache tokens from localStorage at loading time before the host app deletes them.
10. **Token persistence on `globalThis` survives re-injection** — use `globalThis.__openTabs.tokenCache.<pluginName>` to persist auth tokens. Module-level variables reset when the extension reloads. Clear the persisted token on 401 responses to handle token rotation.
11. **Error classification: parse body before HTTP status** — many apps return JSON error codes in the response body that distinguish auth errors from permission errors. Parse the body first, then fall back to HTTP status classification.
12. **Cookie-based auth may require CSRF tokens for writes** — apps using HttpOnly session cookies often require a CSRF token header for non-GET requests. The CSRF token is typically in a non-HttpOnly cookie. Check `window.__initialData.csrfCookieName` or similar bootstrap globals to discover the cookie name.
13. **Check bootstrap globals for auth signals** — `window.__initialData`, `window.__INITIAL_STATE__`, `window.boot_data` are more reliable than DOM for auth detection. Inspect these early during exploration.
14. **Some apps use internal APIs instead of public REST** — the public API may require OAuth2, but the web client uses internal same-origin endpoints with cookie auth. Look for internal endpoints when public API rejects auth.
15. **Intercepted headers must survive adapter re-injection** — store captured tokens on `globalThis.__<pluginName>CapturedTokens`. Re-patch XHR on each adapter load. Avoid stale `if (installed) return` guards that skip re-patching after re-injection.
16. **Trusted Types CSP blocks `innerHTML`** — use regex `html.replace(/<[^>]+>/g, '')` for HTML-to-text conversion instead. Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` in plugin code.
17. **Opaque auth headers can only be captured, not generated** — some apps use cryptographic tokens computed by obfuscated JS. Capture them from the XHR interceptor and implement a polling wait with timeout for the header to appear.
18. **When one API path is blocked, find another** — if a write operation requires an undocumented cryptographic payload, don't give up. Explore the web app's internal extension APIs, JavaScript-exposed programmatic interfaces, or other internal endpoints. Complex apps usually expose higher-level APIs for extensions/accessibility. Use `browser_execute_script` to enumerate non-standard page globals.
19. **Web apps expose programmatic extension APIs on the page** — complex web apps often expose internal scripting APIs on `window` that provide higher-level operations than raw XHR endpoints. Discovery: use `browser_execute_script` with `Object.keys(window).filter(...)` to find non-standard globals, then explore their methods.
20. **Internal API endpoints can be deprecated without warning** — when building plugins for web apps with multiple API generations, test each endpoint independently. If an endpoint returns 404 or 403, it may be deprecated for that account or region. Remove tools that depend on deprecated endpoints rather than shipping broken tools.

---

## Phase 7: Write Learnings Back

Every plugin build surfaces new patterns, gotchas, and techniques. If you discovered something new during this build, update this skill file directly.

### What to Update

- **New auth extraction pattern** — add to the "Auth Token Extraction" or "Advanced Auth Patterns" sections below
- **New gotcha** — add to the "Common Gotchas" list above, numbered sequentially
- **New API discovery technique** — add to Phase 2 above
- **New error handling pattern** — add to the "Common Gotchas" list or the "Error Handling" section in the SDK reference below
- **New Zod schema pattern** — add to the "Zod Schema Rules" section below

---

# Plugin Development Reference

## Architecture

OpenTabs plugins run **in the browser page context**, not on the server. The MCP server discovers plugins, but tool execution happens inside the web page via an adapter IIFE injected by the Chrome extension. This means plugin code has full access to the page's DOM, JavaScript globals, cookies, localStorage, and authenticated fetch requests.

**Flow:** AI client → MCP server → Chrome extension (WebSocket) → adapter IIFE (page context) → tool handler → result back through the chain.

## Plugin Structure

A plugin is a standalone npm package with this structure:

```
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
```

### package.json

```json
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
```

The `opentabs.name` field is the plugin identifier (lowercase, alphanumeric + hyphens). It becomes the tool name prefix (e.g., `myapp_get_data`).

## OpenTabsPlugin Base Class

Every plugin extends `OpenTabsPlugin` and exports an instance:

```typescript
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
```

### Required Members

| Member | Type | Purpose |
|--------|------|---------|
| `name` | `string` | Unique identifier (lowercase alphanumeric + hyphens) |
| `displayName` | `string` | Human-readable name shown in side panel |
| `description` | `string` | Brief plugin description |
| `urlPatterns` | `string[]` | Chrome match patterns for tab injection |
| `tools` | `ToolDefinition[]` | Array of tool definitions |
| `isReady()` | `() => Promise<boolean>` | Readiness probe — returns true when tab is ready for tool calls |

### Tab State Machine

| State | Condition |
|-------|-----------|
| `closed` | No browser tab matches the plugin's URL patterns |
| `unavailable` | Tab matches URL patterns but `isReady()` returns false |
| `ready` | Tab matches URL patterns and `isReady()` returns true |

## defineTool Factory

Each tool is defined with `defineTool`, which provides type inference:

```typescript
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
      `/api/data?q=${encodeURIComponent(params.query)}&limit=${params.limit}`
    );
    return { results: data?.items ?? [], total: data?.total ?? 0 };
  },
});
```

### ToolDefinition Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Tool name (auto-prefixed with plugin name) |
| `displayName` | No | Human-readable name for side panel (auto-derived from name if omitted) |
| `description` | Yes | Shown to AI agents — be specific and include return value info |
| `summary` | No | Short UI summary (falls back to description) |
| `icon` | No | Lucide icon name in kebab-case (defaults to `wrench`) |
| `group` | No | Visual grouping in the side panel |
| `input` | Yes | Zod object schema for parameters |
| `output` | Yes | Zod schema for return value |
| `handle` | Yes | Async function — runs in page context. Second arg is optional `ToolHandlerContext` |

### Progress Reporting

Long-running tools can report progress via the optional `context` parameter:

```typescript
async handle(params, context?: ToolHandlerContext) {
  const items = await getItemList();
  for (let i = 0; i < items.length; i++) {
    context?.reportProgress({ progress: i + 1, total: items.length, message: `Processing ${items[i].name}` });
    await processItem(items[i]);
  }
  return { processed: items.length };
}
```

## Zod Schema Rules

Schemas are serialized to JSON Schema via `z.toJSONSchema()` for MCP registration. Follow these rules:

1. **Never use `.transform()`** — transforms cannot be represented in JSON Schema. Normalize input in the handler.
2. **Avoid `.pipe()`, `.preprocess()`, and effects** — these are runtime-only and break serialization.
3. **`.refine()` callbacks must never throw** — Zod 4 runs refine even on invalid base values. Wrap throwing code in try-catch.
4. **Use `.describe()` on every field** — descriptions are shown to AI agents in the tool schema.
5. **Keep schemas declarative** — primitives, objects, arrays, unions, literals, enums, optional, default.

## Lifecycle Hooks

Optional methods on `OpenTabsPlugin` — implement only what you need:

| Hook | Signature | When Called |
|------|-----------|------------|
| `onActivate` | `() → void` | After adapter registered on `globalThis.__openTabs.adapters` |
| `onDeactivate` | `() → void` | Before adapter removal (fires before `teardown`) |
| `onNavigate` | `(url: string) → void` | On in-page URL changes (pushState, replaceState, popstate, hashchange) |
| `onToolInvocationStart` | `(toolName: string) → void` | Before each `tool.handle()` |
| `onToolInvocationEnd` | `(toolName: string, success: boolean, durationMs: number) → void` | After each `tool.handle()` |
| `teardown` | `() → void` | Before re-injection on plugin update |

Errors in hooks are caught and logged — they do not affect tool execution.

## isReady() Polling Pattern

The extension polls `isReady()` to determine tab state. Common patterns:

```typescript
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
```

## Auth Token Extraction

Plugins extract auth from the page — never ask users for credentials.

```typescript
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
```

## Token Persistence

Module-level variables (`let cachedAuth = null`) are reset when the Chrome extension reloads and re-injects the adapter IIFE. If the host app has already deleted the token from localStorage by this point, the plugin becomes unavailable.

Persist auth tokens to `globalThis.__openTabs.tokenCache.<pluginName>`, which survives adapter re-injection (the page itself is not reloaded — only the IIFE is re-executed).

```typescript
const getPersistedToken = (): string | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as
      | Record<string, unknown>
      | undefined;
    const cache = ns?.tokenCache as
      | Record<string, string | undefined>
      | undefined;
    return cache?.myPlugin ?? null;
  } catch {
    return null;
  }
};

const setPersistedToken = (token: string): void => {
  try {
    const g = globalThis as Record<string, unknown>;
    if (!g.__openTabs) g.__openTabs = {};
    const ns = g.__openTabs as Record<string, unknown>;
    if (!ns.tokenCache) ns.tokenCache = {};
    const cache = ns.tokenCache as Record<string, string | undefined>;
    cache.myPlugin = token;
  } catch {}
};

const clearPersistedToken = (): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as
      | Record<string, unknown>
      | undefined;
    const cache = ns?.tokenCache as
      | Record<string, string | undefined>
      | undefined;
    if (cache) cache.myPlugin = undefined;
  } catch {}
};

// In getAuth():
const getAuth = (): Auth | null => {
  const persisted = getPersistedToken();
  if (persisted) return { token: persisted };

  const raw = readLocalStorage('token');
  if (!raw) return null;
  setPersistedToken(raw);
  return { token: raw };
};
```

Always clear the persisted token on 401 responses to handle token rotation.

## Adapter Injection Timing

Adapters are injected at **two points** during page load:

1. **`loading`** — before page JavaScript runs. The adapter IIFE registers on `globalThis.__openTabs` and can read localStorage/cookies before the host app modifies them.
2. **`complete`** — after the page is fully loaded. The adapter is re-injected (idempotent) and `isReady()` is probed to determine tab state.

This means:
- `isReady()` may be called at both injection points. At `loading` time, page globals do not exist yet — return `false` gracefully. At `complete` time, everything is ready.
- Auth tokens from localStorage should be cached at `loading` time before the host app can delete them.

## Advanced Auth Patterns

### XHR/Fetch Interception

Some web apps use internal RPC endpoints or obfuscated API paths that are hard to discover via network capture. Monkey-patch `XMLHttpRequest` to intercept all API traffic and capture auth headers at runtime.

```typescript
const origOpen = XMLHttpRequest.prototype.open;
const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const origSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method: string, url: string) {
  (this as Record<string, unknown>)._url = url;
  (this as Record<string, unknown>)._method = method;
  return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
};
XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
  if (name.toLowerCase() === 'authorization') {
    setPersistedToken(value); // Capture auth header
  }
  return origSetHeader.apply(this, arguments as unknown as Parameters<typeof origSetHeader>);
};
```

Install the interceptor at adapter load time to capture auth tokens from early boot requests. Store captured tokens on `globalThis` so they survive adapter re-injection.

### Cookie-Based Auth with CSRF

Many web apps use HttpOnly session cookies for auth but require a CSRF token for write operations. The CSRF token is typically in a non-HttpOnly cookie (e.g., `csrftoken`, `sentry-sc`).

```typescript
const csrfToken = getCookie('csrftoken');
const response = await fetch('/api/endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRFToken': csrfToken ?? '',
  },
  body: JSON.stringify(payload),
  credentials: 'include', // HttpOnly cookies sent automatically
});
```

Check `window.__initialData.csrfCookieName` or similar bootstrap globals to discover the cookie name. GET requests work without the CSRF token.

### Opaque Auth Headers

Some apps compute cryptographic auth tokens via obfuscated JavaScript. These tokens cannot be generated — only captured and replayed. Use the XHR interceptor pattern above to capture them, then implement a polling wait:

```typescript
const waitForToken = async (): Promise<string> => {
  for (let i = 0; i < 50; i++) {
    const token = getPersistedToken();
    if (token) return token;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw ToolError.auth('Auth token not captured — try refreshing the page');
};
```

If a write operation returns 200 but the action does not take effect, the cryptographic token may be missing or stale. Capture and replay the token using the XHR interceptor pattern above.

### Extension/Programmatic APIs

When standard API paths are blocked (undocumented crypto tokens, deprecated endpoints), complex web apps often expose higher-level programmatic interfaces:

- Internal extension APIs on `window` (compose, send, draft management)
- JavaScript-exposed infrastructure for accessibility or testing
- `webpackChunk`-based module access to internal stores

Discovery: use `browser_execute_script` with `Object.keys(window).filter(k => !['location', 'chrome', 'document', 'navigator'].includes(k))` to find non-standard globals, then explore their methods.

### API Deprecation

Internal API endpoints can be deprecated without warning. When multiple API generations exist, test each endpoint independently. If an endpoint returns 404 or 403 unexpectedly, it may be deprecated for that account or region. Remove tools that depend on deprecated endpoints rather than shipping broken tools.

## CSP Considerations

The adapter IIFE bypasses the page's Content Security Policy via file-based injection (`chrome.scripting.executeScript({ files: [...] })`). Plugin code runs as extension-origin code and is not subject to inline script restrictions.

**Trusted Types**: Some pages enforce Trusted Types CSP, which blocks `innerHTML`, `outerHTML`, and `insertAdjacentHTML`. If you need to extract text from HTML strings, use regex instead:

```typescript
const text = html.replace(/<[^>]+>/g, '');
```

## Common Patterns

### API Wrapper

```typescript
const API_BASE = '/api/v1';

async function apiGet<T>(path: string): Promise<T> {
  const result = await fetchJSON<T>(`${API_BASE}${path}`);
  if (result === undefined) throw ToolError.internal(`Unexpected empty response from ${path}`);
  return result;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const result = await postJSON<T>(`${API_BASE}${path}`, body);
  if (result === undefined) throw ToolError.internal(`Unexpected empty response from ${path}`);
  return result;
}
```

### Waiting for App State

```typescript
import { waitForSelector, waitUntil, getPageGlobal } from '@opentabs-dev/plugin-sdk';

// Wait for the app to finish loading before executing
await waitForSelector('.app-loaded');

// Wait for a specific global to be set
await waitUntil(() => getPageGlobal('app.initialized') === true);
```

### Retrying Flaky Operations

```typescript
import { retry, ToolError } from '@opentabs-dev/plugin-sdk';

const result = await retry(
  () => fetchJSON<Data>('/api/flaky-endpoint'),
  { maxAttempts: 3, delay: 1000, backoff: true }
);
```

## Build and Test Workflow

```bash
# Build the plugin (generates dist/adapter.iife.js and dist/tools.json)
npx opentabs-plugin build
# Or if installed globally:
opentabs-plugin build

# The build command notifies the running MCP server via POST /reload
# No server restart needed — plugin changes are picked up automatically
```

### Testing During Development

1. Build the plugin: `opentabs-plugin build`
2. Open the target web app in Chrome
3. Verify plugin loaded: call `plugin_list_tabs` from your AI client
4. Test a tool: call any plugin tool (e.g., `myapp_get_data`)
5. Check logs: call `extension_get_logs` to see adapter injection and tool execution logs

### Scaffolding a New Plugin

```bash
npx @opentabs-dev/create-plugin
# Or with the CLI installed:
opentabs plugin create
```

## Publishing to npm

```json
{
  "name": "@scope/opentabs-plugin-myapp",
  "opentabs": {
    "name": "myapp",
    "displayName": "My App",
    "description": "Tools for My App",
    "urlPatterns": ["*://myapp.com/*"]
  }
}
```

Package naming convention: `opentabs-plugin-<name>` or `@scope/opentabs-plugin-<name>`. The MCP server auto-discovers packages matching these patterns in global node_modules.

```bash
npm publish
# Users install with:
opentabs plugin install myapp
```

---

# SDK API Reference

All exports from `@opentabs-dev/plugin-sdk`. Utilities run in the browser page context.

## Core Classes

### OpenTabsPlugin

Abstract base class for all plugins. Extend and export a singleton instance.

```typescript
abstract class OpenTabsPlugin {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly urlPatterns: string[];
  abstract readonly tools: ToolDefinition[];
  abstract isReady(): Promise<boolean>;

  // Optional lifecycle hooks
  teardown?(): void;
  onActivate?(): void;
  onDeactivate?(): void;
  onNavigate?(url: string): void;
  onToolInvocationStart?(toolName: string): void;
  onToolInvocationEnd?(toolName: string, success: boolean, durationMs: number): void;
}
```

### defineTool

Type-safe factory for tool definitions:

```typescript
function defineTool<TInput, TOutput>(config: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput>
```

### ToolDefinition

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string;
  displayName?: string;
  description: string;
  summary?: string;
  icon?: LucideIconName;   // Lucide icon in kebab-case (default: 'wrench')
  group?: string;
  input: TInput;           // Zod object schema
  output: TOutput;         // Zod schema
  handle(params: z.infer<TInput>, context?: ToolHandlerContext): Promise<z.infer<TOutput>>;
}
```

### ToolHandlerContext

```typescript
interface ToolHandlerContext {
  reportProgress(opts: { progress?: number; total?: number; message?: string }): void;
}
```

## DOM Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `waitForSelector` | `<T extends Element>(selector, opts?) => Promise<T>` | Wait for element to appear (MutationObserver, default 10s) |
| `waitForSelectorRemoval` | `(selector, opts?) => Promise<void>` | Wait for element to be removed (default 10s) |
| `querySelectorAll` | `<T extends Element>(selector) => T[]` | Returns real array (not NodeList) |
| `getTextContent` | `(selector) => string \| null` | Trimmed textContent of first match |
| `observeDOM` | `(selector, callback, opts?) => () => void` | MutationObserver, returns cleanup function |

Options: `{ timeout?: number; signal?: AbortSignal }` for wait functions. `{ childList?: boolean; attributes?: boolean; subtree?: boolean }` for observeDOM.

## Fetch Utilities

All fetch utilities use `credentials: 'include'` to leverage the page's authenticated session. Default timeout: 30s.

| Function | Signature | Description |
|----------|-----------|-------------|
| `fetchFromPage` | `(url, init?) => Promise<Response>` | Fetch with session cookies, throws ToolError on non-ok |
| `fetchJSON` | `<T>(url, init?, schema?) => Promise<T>` | GET + JSON parse. Optional Zod validation |
| `postJSON` | `<T>(url, body, init?, schema?) => Promise<T>` | POST JSON body + parse response |
| `putJSON` | `<T>(url, body, init?, schema?) => Promise<T>` | PUT JSON body + parse response |
| `patchJSON` | `<T>(url, body, init?, schema?) => Promise<T>` | PATCH JSON body + parse response |
| `deleteJSON` | `<T>(url, init?, schema?) => Promise<T>` | DELETE + parse response |
| `postForm` | `<T>(url, body, init?, schema?) => Promise<T>` | POST URL-encoded form (Record<string,string>) |
| `postFormData` | `<T>(url, body, init?, schema?) => Promise<T>` | POST multipart/form-data (FormData) |

When a Zod schema is passed as the last argument, the response is validated against it.

Helper functions:
- `httpStatusToToolError(response, message)` — maps HTTP status to ToolError category
- `parseRetryAfterMs(value)` — parses Retry-After header to milliseconds

Options extend `RequestInit` with `{ timeout?: number }`.

## Storage Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `getLocalStorage` | `(key) => string \| null` | Safe localStorage read (null on SecurityError) |
| `setLocalStorage` | `(key, value) => void` | Safe localStorage write |
| `removeLocalStorage` | `(key) => void` | Safe localStorage remove |
| `getSessionStorage` | `(key) => string \| null` | Safe sessionStorage read |
| `setSessionStorage` | `(key, value) => void` | Safe sessionStorage write |
| `removeSessionStorage` | `(key) => void` | Safe sessionStorage remove |
| `getCookie` | `(name) => string \| null` | Parse cookie by name from document.cookie |

All storage functions catch SecurityError (sandboxed iframes) and return null / no-op silently.

## Page State Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `getPageGlobal` | `(path) => unknown` | Deep property access on globalThis via dot-notation (e.g., `'app.auth.token'`) |
| `getCurrentUrl` | `() => string` | Returns window.location.href |
| `getPageTitle` | `() => string` | Returns document.title |

`getPageGlobal` blocks access to `__proto__`, `constructor`, `prototype`.

## Timing Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `sleep` | `(ms, opts?) => Promise<void>` | Promisified setTimeout. Options: `{ signal?: AbortSignal }` |
| `retry` | `<T>(fn, opts?) => Promise<T>` | Retry with configurable attempts, delay, backoff |
| `waitUntil` | `(predicate, opts?) => Promise<void>` | Poll predicate at interval until true |

**retry options:** `{ maxAttempts?: 3, delay?: 1000, backoff?: false, maxDelay?: 30000, signal?: AbortSignal }`

**waitUntil options:** `{ interval?: 200, timeout?: 10000, signal?: AbortSignal }`

## Logging

```typescript
import { log } from '@opentabs-dev/plugin-sdk';

log.debug(message, ...args);
log.info(message, ...args);
log.warn(message, ...args);
log.error(message, ...args);
```

Log entries route through the extension to the MCP server and connected clients. Falls back to `console` methods outside the adapter runtime. Args are safely serialized (handles circular refs, DOM nodes, functions).

## Error Handling

### ToolError

Structured error class with metadata for AI clients:

```typescript
class ToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly category: ErrorCategory | undefined;

  static auth(message, code?): ToolError;           // category: 'auth', not retryable
  static notFound(message, code?): ToolError;        // category: 'not_found', not retryable
  static rateLimited(message, retryAfterMs?, code?): ToolError;  // category: 'rate_limit', retryable
  static validation(message, code?): ToolError;      // category: 'validation', not retryable
  static timeout(message, code?): ToolError;         // category: 'timeout', retryable
  static internal(message, code?): ToolError;        // category: 'internal', not retryable
}
```

`ErrorCategory`: `'auth' | 'rate_limit' | 'not_found' | 'validation' | 'internal' | 'timeout'`

## Lifecycle Hooks

Optional methods on `OpenTabsPlugin`:

| Hook | When Called |
|------|------------|
| `onActivate()` | After adapter registered on `globalThis.__openTabs.adapters` |
| `onDeactivate()` | Before adapter removal |
| `teardown()` | Before re-injection on plugin update |
| `onNavigate(url)` | On in-page URL changes (pushState, replaceState, popstate, hashchange) |
| `onToolInvocationStart(toolName)` | Before each tool handler call |
| `onToolInvocationEnd(toolName, success, durationMs)` | After each tool handler call |

Errors in hooks are caught and logged — they do not affect tool execution.

## Re-exports from @opentabs-dev/shared

| Export | Description |
|--------|-------------|
| `ManifestTool` | Tool metadata type for plugin manifests |
| `Manifest` | Complete plugin manifest type (`PluginManifest`) |
| `validatePluginName(name)` | Validates plugin name against `NAME_REGEX` and `RESERVED_NAMES` |
| `validateUrlPattern(pattern)` | Validates Chrome match patterns |
| `NAME_REGEX` | Regex for valid plugin names |
| `RESERVED_NAMES` | Set of reserved plugin names |
| `LucideIconName` | String literal union of valid Lucide icon names |
| `LUCIDE_ICON_NAMES` | Array of all valid Lucide icon names |
