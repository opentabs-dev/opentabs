# Build Plugin Skill

Build a production-ready OpenTabs plugin for any web application. This skill guides the full workflow from reconnaissance through implementation to testing.

---

## Prerequisites

- The user has the target web app open in a browser tab
- The `opentabs` CLI is installed globally
- The MCP server is running (`opentabs start` or `npm run dev:mcp`)

### Browser Tool Permissions

Plugin development requires heavy use of browser tools (`browser_execute_script`, `browser_navigate_tab`, `browser_get_tab_content`, etc.) for exploring the target web app. By default, many of these tools require human approval in the Chrome extension side panel, with a 30-second timeout that blocks the AI agent.

**Before starting, ask the user if they want to enable `--dangerously-skip-permissions`** to bypass all confirmation dialogs during the development session. This dramatically speeds up the exploration and testing phases.

Three ways to enable it:

1. Restart the MCP server: `opentabs start --dangerously-skip-permissions`
2. Set the env var: `OPENTABS_SKIP_PERMISSIONS=1`
3. Add to `~/.opentabs/config.json`: `{ "skipPermissions": true }`

**Warn the user**: this disables all human-in-the-loop safety for browser tool operations. It should only be used during active plugin development sessions and disabled afterward.

If the user declines, plan for confirmation timeouts when using browser tools — use read-only tools like `opentabs_plugin_list_tabs` (no confirmation needed) where possible, and batch browser tool calls to minimize the number of approvals needed.

---

## Phase 1: Research the Codebase

Before writing any code, study the existing plugin infrastructure. Use the Task tool with `explore` agent for each of these:

1. **Study the Plugin SDK** — read `platform/plugin-sdk/CLAUDE.md` and key source files (`src/index.ts`, `src/plugin.ts`, `src/tool.ts`). Understand:
   - `OpenTabsPlugin` abstract base class (name, displayName, description, urlPatterns, tools, isReady)
   - `defineTool({ name, displayName, description, icon, input, output, handle })` factory
   - `ToolError` static factories: `.auth()`, `.notFound()`, `.rateLimited()`, `.timeout()`, `.validation()`, `.internal()`
   - SDK utilities: `fetchJSON`, `postJSON`, `getLocalStorage`, `waitForSelector`, `retry`, `sleep`, `log`
   - All plugin code runs in the **browser page context** (not server-side)

2. **Study the Slack plugin** (`plugins/slack/`) — this is the canonical reference:
   - `src/index.ts` — plugin class, imports all tools
   - `src/slack-api.ts` — API wrapper with auth extraction + error classification
   - `src/tools/` — one file per tool, shared schemas in `channel-schema.ts`
   - `package.json` — the opentabs field, dependency versions, scripts

3. **Study `plugins/CLAUDE.md`** — plugin isolation rules and conventions

---

## Phase 2: Scaffold the Plugin

```bash
cd plugins/
opentabs plugin create <name> --domain <domain> --display <DisplayName> --description "OpenTabs plugin for <DisplayName>"
```

### Post-Scaffold Adjustments

The scaffolded `package.json` needs adjustments to match the established pattern. Compare with `plugins/slack/package.json` and align:

- **Package name**: Change to `@opentabs-dev/opentabs-plugin-<name>` for official plugins
- **Version**: Match the current platform version (check `plugins/slack/package.json` for the right version)
- **Add fields**: `publishConfig`, top-level `description`, `check` script
- **Dependency versions**: Match `@opentabs-dev/plugin-sdk` and `@opentabs-dev/plugin-tools` versions to what Slack uses
- **Dev script**: Use `tsc --watch --preserveWatchOutput & opentabs-plugin build --watch` (shell background, no concurrently)
- **Remove**: `concurrently` from devDependencies if present
- **Dev dependencies**: Match versions of eslint, prettier, typescript, typescript-eslint, zod, jiti to what Slack uses

---

## Phase 3: Explore the Target Web App

This is the most critical phase. Use browser tools to understand how the web app works.

### Step 1: Find the Tab

```
opentabs_browser_list_tabs  →  find the target tab ID
```

### Step 2: Enable Network Capture

```
opentabs_browser_enable_network_capture(tabId, urlFilter: "/api")
```

Then navigate around in the app to trigger API calls, and read them:

```
opentabs_browser_get_network_requests(tabId)
```

Study the captured traffic to understand:

- API base URL (e.g., `https://app.example.com/api/v2`)
- Request format (JSON body vs form-encoded)
- Required headers (content-type, custom headers like `X-Workspace-Id`)
- Response shapes for each endpoint
- Error response format

**Note**: Authorization headers are redacted by the capture tool. You must discover the auth token format through other means.

### Step 3: Discover Auth Token

Use `opentabs_browser_execute_script` to probe the page for auth tokens. Try these strategies in order:

**Strategy A: localStorage** (most common)

```javascript
// Try direct access first
const token = localStorage.getItem('token') || localStorage.getItem('access_token');

// If localStorage is undefined (some SPAs delete it), use iframe fallback
if (typeof window.localStorage === 'undefined') {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  const token = iframe.contentWindow.localStorage.getItem('token');
  document.body.removeChild(iframe);
}
```

**Strategy B: Page globals**

```javascript
// Check common globals
window.__APP_STATE__;
window.boot_data;
window.__NEXT_DATA__;
window.__INITIAL_STATE__;
```

**Strategy C: Webpack module stores** (for React/webpack SPAs)

```javascript
let wreq = null;
window.webpackChunkapp_name.push([
  [Symbol()],
  {},
  r => {
    wreq = r;
  },
]);
window.webpackChunkapp_name.pop();
// Then search wreq.c (cached modules) for store objects with getToken methods
```

**Strategy D: Cookies**

```javascript
document.cookie; // Look for session tokens, JWT cookies
```

**Strategy E: Script tag scanning**

```javascript
// Search inline <script> tags for embedded tokens/config
document.querySelectorAll('script:not([src])').forEach(s => {
  if (s.textContent.includes('token')) console.log(s.textContent.substring(0, 500));
});
```

### Step 4: Test the API

Once you have the token, make a test API call:

```javascript
const resp = await fetch('https://example.com/api/v2/me', {
  headers: { Authorization: 'Bearer ' + token },
  credentials: 'include',
});
const data = await resp.json();
```

Verify the response shape and that auth works.

### Step 5: Map the API Surface

Make test calls to discover the key API endpoints. For a typical web app, look for:

- User/profile endpoint
- List resources (channels, projects, items, etc.)
- Get single resource
- Create/update/delete resources
- Search
- Messaging/comments
- Reactions/likes

---

## Phase 4: Design the Tool Set

Model the tool set after the Slack plugin. A typical production plugin has 15-25 tools across these categories:

**Messaging/Content:**

- `send_message` — create new content
- `edit_message` — modify existing content
- `delete_message` — remove content
- `read_messages` — list/paginate content
- `search_messages` — search with filters

**Resources/Containers:**

- `list_<resources>` — list containers (channels, projects, boards)
- `get_<resource>_info` — get details for one container
- `create_<resource>` — create a new container

**Users/Members:**

- `list_members` — list users in a container
- `get_user_profile` — get user details

**Interactions:**

- `add_reaction` / `remove_reaction`
- `pin_message` / `unpin_message`

**Platform-specific:**

- Add tools unique to the platform (threads, DMs, file uploads, etc.)

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
    edit-message.ts
    ...
```

### API Wrapper Pattern (`<name>-api.ts`)

This is the most critical file. Follow this pattern:

```typescript
import { ToolError } from '@opentabs-dev/plugin-sdk';

interface AppAuth {
  token: string;
  // Add other auth fields as needed (workspace URL, team ID, etc.)
}

// --- Auth extraction ---
const getAuth = (): AppAuth | null => {
  // Try localStorage (with iframe fallback if needed)
  // Try page globals
  // Try cookies
  // Return null if not authenticated
};

export const isAuthenticated = (): boolean => getAuth() !== null;

// SPA hydration: poll for auth to become available after page load
export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isAuthenticated()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= maxWait) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });

// --- API caller ---
export const api = async <T extends Record<string, unknown>>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  // Build URL with query params
  let url = `https://example.com/api/v2${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  // Set headers
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  // Make request with 30-second timeout
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  // Classify HTTP errors
  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
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
import { mapMessage, messageSchema } from './schemas.js';

export const sendMessage = defineTool({
  name: 'send_message', // snake_case, auto-prefixed with plugin name
  displayName: 'Send Message', // Title Case
  description: 'Send a message to a channel', // clear for AI agents
  icon: 'send', // valid Lucide icon name
  input: z.object({
    channel: z.string().describe('Channel ID to send the message to'), // .describe() on EVERY field
    content: z.string().describe('Message text content'),
  }),
  output: z.object({
    message: messageSchema.describe('The sent message'),
  }),
  handle: async params => {
    const data = await api<Record<string, unknown>>('/channels/' + params.channel + '/messages', {
      method: 'POST',
      body: { content: params.content },
    });
    return { message: mapMessage(data) }; // defensive mapping with fallback defaults
  },
});
```

### Shared Schemas Pattern (`tools/schemas.ts`)

```typescript
import { z } from 'zod';

export const messageSchema = z.object({
  id: z.string().describe('Message ID'),
  channel_id: z.string().describe('Channel ID'),
  content: z.string().describe('Message text content'),
  timestamp: z.string().describe('ISO 8601 timestamp'),
});

// Defensive mapper with fallback defaults
export const mapMessage = (m: Record<string, unknown> | undefined) => ({
  id: (m?.id as string) ?? '',
  channel_id: (m?.channel_id as string) ?? '',
  content: (m?.content as string) ?? '',
  timestamp: (m?.timestamp as string) ?? '',
});
```

### Plugin Class Pattern (`index.ts`)

```typescript
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './<name>-api.js';
import { sendMessage } from './tools/send-message.js';
// ... import all tools

class MyPlugin extends OpenTabsPlugin {
  readonly name = '<name>';
  readonly description = 'OpenTabs plugin for <DisplayName>';
  override readonly displayName = '<DisplayName>';
  readonly urlPatterns = ['*://*.example.com/*'];
  readonly tools: ToolDefinition[] = [sendMessage /* ... all tools */];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth(); // poll for SPA hydration
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
npm run build        # tsc + opentabs-plugin build
```

Build produces:

- `dist/adapter.iife.js` — the browser-injectable adapter
- `dist/tools.json` — manifest with JSON schemas
- Auto-registers in `~/.opentabs/config.json`
- Notifies MCP server via `POST /reload`

### Fix Lint/Format Issues

```bash
npm run lint:fix     # auto-fix ESLint/prettier issues
npm run format       # format all files
```

### Full Check Suite

```bash
npm run check        # build + type-check + lint + format:check
```

**Every command must exit 0.** Fix any failures before proceeding.

### Test with Real Browser Tab

1. Verify the plugin loaded:

   ```
   opentabs_plugin_list_tabs(plugin: "<name>")
   ```

   Must show `state: "ready"` and `ready: true` for the matching tab.

2. Call each tool and verify it returns expected data. Start with read-only tools (list, get) before write tools (send, create, delete).

3. Test error cases: invalid IDs, missing permissions, etc.

---

## Key Conventions

- **One file per tool** in `src/tools/`
- **Every Zod field gets `.describe()`** — this is what AI agents see in the tool schema
- **Defensive mapping** with fallback defaults (`data.field ?? ''`) — never trust API response shapes
- **`context` parameter is optional**: `handle: async (params, context?) => { ... }`
- **Tools return objects**, never raw primitives
- **Error classification is critical** — use `ToolError` factories, never throw raw errors
- **`credentials: 'include'`** on all fetch calls — required for cookie-based auth
- **30-second timeout** via `AbortSignal.timeout(30_000)` on all fetch calls
- **`.js` extension** on all imports (ESM requirement): `import { api } from '../<name>-api.js'`
- **Zod schemas must be declarative** — no `.transform()`, `.pipe()`, `.preprocess()` (breaks JSON Schema serialization)

---

## Token Persistence Pattern

The adapter IIFE is re-executed when the Chrome extension reloads (e.g., during development, updates, or hot reload). Module-level variables like `let cachedAuth = null` are reset to their initial values on re-injection. If the host app has already deleted the token from localStorage by this point, the plugin becomes unavailable.

**Solution**: Persist auth tokens to `globalThis.__openTabs.tokenCache.<pluginName>` which survives adapter re-injection (the page itself isn't reloaded, only the IIFE is re-executed).

```typescript
// Persist token to globalThis (survives adapter re-injection)
const getPersistedToken = (): string | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, string | undefined> | undefined;
    return cache?.myPlugin ?? null;
  } catch {
    return null;
  }
};

const setPersistedToken = (token: string): void => {
  try {
    const ns = ((globalThis as Record<string, unknown>).__openTabs ??= {}) as Record<string, unknown>;
    const cache = (ns.tokenCache ??= {}) as Record<string, string | undefined>;
    cache.myPlugin = token;
  } catch {}
};

const clearPersistedToken = (): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, string | undefined> | undefined;
    if (cache) cache.myPlugin = undefined;
  } catch {}
};

// In getAuth():
const getAuth = (): Auth | null => {
  const persisted = getPersistedToken();
  if (persisted) return { token: persisted };

  const raw = readLocalStorage('token');
  if (!raw) return null;
  // ... parse token ...
  setPersistedToken(token);
  return { token };
};
```

Always clear the persisted token on 401 responses to handle token rotation.

---

## Adapter Injection Timing

Adapters are injected at **two points** during page load:

1. **`status: 'loading'`** — before page JavaScript runs. The adapter IIFE registers on `globalThis.__openTabs` and can read localStorage/cookies before the host app modifies them.
2. **`status: 'complete'`** — after page is fully loaded. The adapter is re-injected (idempotent) and `isReady()` is probed to determine tab state.

This means:

- `isReady()` may be called twice — once at loading time (when page globals don't exist yet) and once at complete time (when everything is ready). The polling pattern handles this naturally.
- Auth tokens read from localStorage at loading time are available before the host app can delete them. Cache them immediately.

---

## Error Classification Best Practices

**Parse the API response body for error codes before classifying by HTTP status.** Many web apps reuse HTTP status codes for different error types:

```typescript
// BAD: classify by HTTP status only
if (response.status === 403) throw ToolError.auth('...'); // Wrong for permission errors!

// GOOD: parse body first, fall back to HTTP status
const errorBody = await response.text();
let apiCode: number | undefined;
try {
  apiCode = (JSON.parse(errorBody) as { code?: number }).code;
} catch {}

if (apiCode !== undefined) {
  if (VALIDATION_ERRORS.has(apiCode)) throw ToolError.validation('...');
  if (NOT_FOUND_ERRORS.has(apiCode)) throw ToolError.notFound('...');
  if (AUTH_ERRORS.has(apiCode)) throw ToolError.auth('...');
}
// Fall back to HTTP status
if (response.status === 401 || response.status === 403) throw ToolError.auth('...');
```

---

## Testing Checklist

After implementing all tools, test these scenarios:

1. **Fresh page load** — verify `isReady()` returns true and all tools work
2. **Wait for host app initialization** — verify tools still work after the host app finishes its boot process (some apps delete localStorage, modify globals, etc.)
3. **Extension reload** — reload the Chrome extension (`opentabs_extension_reload`), then verify the plugin stays ready and tools still work (tests globalThis token persistence)
4. **Multiple extension reloads** — verify consistency across repeated re-injections
5. **Full page reload** — verify the clean path works (fresh token from localStorage)
6. **Error cases** — test with invalid IDs, missing permissions, rate limiting

### Browser Tool Confirmations

When using browser tools during testing (like `browser_navigate_tab`, `browser_execute_script`), these require **human approval** in the Chrome extension side panel. The confirmation dialog times out after 30 seconds. Plan for this:

- Use `opentabs_plugin_list_tabs` (no confirmation needed) to check plugin state
- Ask the user to watch the side panel when you need to call browser tools
- If a tool times out with `CONFIRMATION_TIMEOUT`, ask the user to approve and retry

---

## Common Gotchas

1. **All plugin code runs in the browser** — no Node.js APIs, no filesystem, no server-side logic
2. **SPAs hydrate asynchronously** — `isReady()` must poll, not just check once (500ms interval, 3-5s max wait)
3. **Some apps delete browser APIs** — Discord deletes `window.localStorage`; use iframe fallback when `typeof window.localStorage === 'undefined'`
4. **Tokens must persist on globalThis** — module-level variables are reset when the extension reloads and re-injects the adapter. Use `globalThis.__openTabs.tokenCache.<pluginName>` instead.
5. **API responses may return arrays** — when the generic type expects `Record<string, unknown>` but the endpoint returns an array, use `Array.isArray(data) ? (data as T[]).map(...) : []`
6. **Parse error response bodies before HTTP status** — web apps reuse 403 for both auth and permission errors. The error code in the body distinguishes them.
7. **Icons must be valid Lucide names** — TypeScript catches invalid ones at build time
8. **Prettier formatting** — always run `npm run format` after writing code; the project's config may differ from your defaults
9. **The `opentabs` field in `package.json`** is how the platform discovers plugin metadata — `displayName`, `description`, and `urlPatterns` must be there
10. **Browser tools require human approval** — `browser_navigate_tab`, `browser_execute_script`, etc. show a confirmation dialog that times out in 30 seconds
