# Build Plugin Skill

Build a production-ready OpenTabs plugin for any web application. This skill guides the full workflow from reconnaissance through implementation to testing.

---

## Prerequisites

- The user has the target web app open in a browser tab
- The `opentabs` CLI is installed globally
- The MCP server is running (`opentabs start` or `npm run dev:mcp`)

### Browser Tool Permissions

Plugin development requires heavy use of browser tools (`browser_execute_script`, `browser_navigate_tab`, `browser_get_tab_content`, etc.) for exploring the target web app. By default, all tools have permission `'off'` (disabled). Tools set to `'ask'` require human approval in the Chrome extension side panel before executing.

**Before starting, ask the user if they want to enable `skipPermissions`** to bypass all permission checks during the development session. This sets all tools to `'auto'` (execute immediately), dramatically speeding up exploration and testing.

Three ways to enable it:

1. Restart the MCP server: `opentabs start --dangerously-skip-permissions`
2. Set the env var: `OPENTABS_SKIP_PERMISSIONS=1`
3. Add to `~/.opentabs/config.json`: `{ "skipPermissions": true }`

Alternatively, set specific plugins or tools to `'auto'` in `~/.opentabs/config.json`:
```json
{ "plugins": { "browser": { "permission": "auto" } } }
```

**Warn the user**: `skipPermissions` disables all human-in-the-loop safety for tool operations. It should only be used during active plugin development sessions and disabled afterward.

If the user declines, set browser tools to `'ask'` permission and plan for manual approvals — use read-only tools like `opentabs_plugin_list_tabs` (no approval needed when set to `'auto'`) where possible, and batch browser tool calls to minimize the number of approvals needed.

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
- **Dev dependencies**: Match versions of @biomejs/biome, typescript, zod to what Slack uses

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
- **Whether the API is same-origin or cross-origin** (critical for CORS planning)
- Request format (JSON body vs form-encoded)
- Required headers (content-type, custom headers like `X-Workspace-Id`)
- Response shapes for each endpoint
- Error response format

**Note**: Authorization headers are redacted by the capture tool. You must discover the auth token format through other means.

### Step 2b: Check CORS Policy (for Cross-Origin APIs)

If the API is on a different subdomain (e.g., `api.example.com` when the page is on `app.example.com`), verify CORS behavior before writing any API code:

```bash
curl -sI -X OPTIONS https://api.example.com/endpoint \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  | grep -i "access-control"
```

What to look for:

- `access-control-allow-origin: *` — CORS allowed, but **`credentials: 'include'` will NOT work** (browser rejects cookies with wildcard origin). Only token-based auth works.
- `access-control-allow-origin: https://app.example.com` + `access-control-allow-credentials: true` — Full cookie auth works with `credentials: 'include'`.
- No CORS headers — Cross-origin requests are fully blocked; must use same-origin endpoints.

**Same-origin API fallback**: Many apps expose same-origin API proxies or internal endpoints. Look for:

- `/api/...` paths on the same domain
- `/_graphql` internal GraphQL endpoint
- JSON responses from standard page URLs with `Accept: application/json`

### Step 3: Discover Auth Token

**First, always check cookies with `opentabs_browser_get_cookies`** to understand the auth model:

- Look for `httpOnly: true` cookies — these are session tokens the browser sends automatically but JS cannot read
- If auth is HttpOnly cookie-based, skip trying to extract the token; instead detect auth from the DOM (meta tags, page globals) and let `credentials: 'include'` send the cookies automatically
- Look for non-HttpOnly tokens that can be read with `getCookie()`

Use `opentabs_browser_execute_script` to probe the page for auth tokens. The tool bypasses page CSP via file-based injection and works on all pages regardless of Content Security Policy. Try these strategies in order:

**Strategy A: localStorage** (most common)

```javascript
// Try direct access first
const token =
  localStorage.getItem("token") || localStorage.getItem("access_token");

// If localStorage is undefined (some SPAs delete it), use iframe fallback
if (typeof window.localStorage === "undefined") {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);
  const token = iframe.contentWindow.localStorage.getItem("token");
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
  (r) => {
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
document.querySelectorAll("script:not([src])").forEach((s) => {
  if (s.textContent.includes("token"))
    console.log(s.textContent.substring(0, 500));
});
```

### Step 4: Test the API

Once you have the token, make a test API call:

```javascript
const resp = await fetch("https://example.com/api/v2/me", {
  headers: { Authorization: "Bearer " + token },
  credentials: "include",
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
import { ToolError } from "@opentabs-dev/plugin-sdk";

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
  new Promise((resolve) => {
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
  if (!auth) throw ToolError.auth("Not authenticated — please log in.");

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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };
  let fetchBody: string | undefined;
  if (options.body) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(options.body);
  }

  // Make request with 30-second timeout
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: fetchBody,
      credentials: "include",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "TimeoutError")
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === "AbortError")
      throw new ToolError("Request was aborted", "aborted");
    throw new ToolError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      "network_error",
      {
        category: "internal",
        retryable: true,
      },
    );
  }

  // Classify HTTP errors
  if (!response.ok) {
    const errorBody = (await response.text().catch(() => "")).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
      throw ToolError.rateLimited(
        `Rate limited: ${endpoint} — ${errorBody}`,
        retryMs,
      );
    }
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404)
      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(
      `API error (${response.status}): ${endpoint} — ${errorBody}`,
    );
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
```

### Tool Pattern (one file per tool)

```typescript
import { defineTool } from "@opentabs-dev/plugin-sdk";
import { z } from "zod";
import { api } from "../<name>-api.js";
import { mapMessage, messageSchema } from "./schemas.js";

export const sendMessage = defineTool({
  name: "send_message", // snake_case, auto-prefixed with plugin name
  displayName: "Send Message", // Title Case
  description:
    "Send a message to a Slack channel or thread. " +
    "Supports Slack mrkdwn formatting.", // detailed for MCP AI clients — this is what Claude sees
  summary: "Send a message to a channel or thread", // short, human-readable — shown in the side panel UI
  icon: "send", // valid Lucide icon name
  input: z.object({
    channel: z.string().describe("Channel ID to send the message to"), // .describe() on EVERY field
    content: z.string().describe("Message text content"),
  }),
  output: z.object({
    message: messageSchema.describe("The sent message"),
  }),
  handle: async (params) => {
    const data = await api<Record<string, unknown>>(
      "/channels/" + params.channel + "/messages",
      {
        method: "POST",
        body: { content: params.content },
      },
    );
    return { message: mapMessage(data) }; // defensive mapping with fallback defaults
  },
});
```

### Shared Schemas Pattern (`tools/schemas.ts`)

```typescript
import { z } from "zod";

export const messageSchema = z.object({
  id: z.string().describe("Message ID"),
  channel_id: z.string().describe("Channel ID"),
  content: z.string().describe("Message text content"),
  timestamp: z.string().describe("ISO 8601 timestamp"),
});

// Defensive mapper with fallback defaults
export const mapMessage = (m: Record<string, unknown> | undefined) => ({
  id: (m?.id as string) ?? "",
  channel_id: (m?.channel_id as string) ?? "",
  content: (m?.content as string) ?? "",
  timestamp: (m?.timestamp as string) ?? "",
});
```

### Plugin Class Pattern (`index.ts`)

```typescript
import { OpenTabsPlugin } from "@opentabs-dev/plugin-sdk";
import type { ToolDefinition } from "@opentabs-dev/plugin-sdk";
import { isAuthenticated, waitForAuth } from "./<name>-api.js";
import { sendMessage } from "./tools/send-message.js";
// ... import all tools

class MyPlugin extends OpenTabsPlugin {
  readonly name = "<name>";
  readonly description = "OpenTabs plugin for <DisplayName>";
  override readonly displayName = "<DisplayName>";
  readonly urlPatterns = ["*://*.example.com/*"];
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
npm run lint:fix     # auto-fix Biome lint issues
npm run format       # format all files with Biome
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

## Phase 7: Document Friction and Feed Back

This phase is **mandatory**. Every plugin build surfaces friction in the platform and new learnings about how to develop plugins well. Capturing them closes the loop.

### 1. Document Friction Encountered

While building and testing, keep a running mental note of anything that slowed you down, required workarounds, or was confusing. After the plugin is working, think across **three dimensions of friction**:

**Platform bugs and rough edges** — things that were broken or wrong:
- Scaffolder generated wrong versions, missing fields, or unhelpful defaults
- A platform API returned an unexpected shape or error
- A build/lint/type-check failure caused by a platform issue (not a plugin bug)
- A browser tool limitation that required a workaround

**Missing SDK capabilities** — things you had to hand-roll that the SDK should provide:
- Ask: *"If the SDK had a helper for X, would virtually every plugin developer hit this same need?"*
- Examples of things that clear the bar: retry logic, cookie parsing, request timeout wiring, token persistence boilerplate — these are universal to all plugins regardless of what app they target
- Examples of things that do NOT clear the bar: resolving a Notion workspace ID, normalizing a Discord message shape, handling Slack's rate limit headers — these are app-specific, not platform-level concerns
- **The test is universality, not frequency.** Something that every plugin needs once beats something a few plugins need repeatedly. If the need is tied to a specific app's quirks, it belongs in that plugin — not in the SDK.

**Missing documentation or guidance** — things that required trial and error to discover:
- Auth patterns not covered in the scaffold comments or skill
- API behaviors that weren't obvious and required `browser_execute_script` experimentation
- Conventions that exist in the codebase but aren't written down anywhere

For each friction point, ask: **is this something the platform team can fix or add?** If yes, it belongs in a PRD.

### 2. Create PRDs for Friction Fixes

Use the `ralph` skill to create a PRD for any actionable friction. Run it at the end once all friction is identified — batch related fixes into one PRD where they touch the same files:

```
/ralph  create PRD for <brief description of friction>
```

Each PRD story must:
- Target exactly one file or closely related set of files
- Have a concrete acceptance criterion (not "works better")
- Be completable by a fresh AI agent in one iteration

### 3. Write Learnings Back to This Skill

After building the plugin, update this file (`__SKILL__.md`) with any new patterns or gotchas discovered. Follow these rules:

**Before adding anything:**
- Read the existing Common Gotchas list and all named sections
- Check whether the insight is already covered — if it is, skip or merge rather than add
- Ask: *does this save meaningful time for the next agent, or is it obvious from context?*

**What belongs here:**
- Auth patterns specific to a new class of web app (not already covered)
- API quirks that are non-obvious and will recur (e.g., response shape varies by endpoint)
- Platform constraints that bite developers repeatedly
- Concrete workarounds for known gotchas

**What does NOT belong here:**
- App-specific details that won't recur (e.g., "Notion uses space IDs")
- Learnings already captured in an existing gotcha
- Notes that belong in the plugin's own README

**Deduplication is required:** After adding anything, scan the full gotcha list for overlap with existing items. Merge if two gotchas teach the same lesson. The list should always be the shortest version that conveys maximum value.

---

## Key Conventions

- **One file per tool** in `src/tools/`
- **Every Zod field gets `.describe()`** — this is what AI agents see in the tool schema
- **`description` is for MCP AI clients** — write a detailed, informative description that helps Claude (or other AI agents) understand when and how to use the tool. Include parameter semantics, supported formats, and behavioral notes. This is what appears in the MCP `tools/list` response.
- **`summary` is for humans in the side panel** — write a short (under 80 chars), plain-English sentence. The side panel tooltip and inline description show `summary` when available, falling back to `description`. Every tool must have both fields.
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

  const raw = readLocalStorage("token");
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
if (response.status === 403) throw ToolError.auth("..."); // Wrong for permission errors!

// GOOD: parse body first, fall back to HTTP status
const errorBody = await response.text();
let apiCode: number | undefined;
try {
  apiCode = (JSON.parse(errorBody) as { code?: number }).code;
} catch {}

if (apiCode !== undefined) {
  if (VALIDATION_ERRORS.has(apiCode)) throw ToolError.validation("...");
  if (NOT_FOUND_ERRORS.has(apiCode)) throw ToolError.notFound("...");
  if (AUTH_ERRORS.has(apiCode)) throw ToolError.auth("...");
}
// Fall back to HTTP status
if (response.status === 401 || response.status === 403)
  throw ToolError.auth("...");
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

When using browser tools during testing (like `browser_navigate_tab`, `browser_execute_script`), tools with `'ask'` permission require **human approval** in the Chrome extension side panel before executing.

- Use `opentabs_plugin_list_tabs` (set to `'auto'` by default with `skipPermissions`) to check plugin state
- Ask the user to watch the side panel when you need to call tools set to `'ask'`
- If a tool returns a "denied by the user" error, ask the user to approve and retry

---

## Common Gotchas

1. **All plugin code runs in the browser** — no Node.js APIs, no filesystem, no server-side logic
2. **SPAs hydrate asynchronously** — `isReady()` must poll, not just check once (500ms interval, 3-5s max wait)
3. **Some apps delete browser APIs** — Discord deletes `window.localStorage`; use iframe fallback when `typeof window.localStorage === 'undefined'`
4. **Tokens must persist on globalThis** — module-level variables are reset when the extension reloads and re-injects the adapter. Use `globalThis.__openTabs.tokenCache.<pluginName>` instead.
5. **API responses may return arrays** — when the generic type expects `Record<string, unknown>` but the endpoint returns an array, use `Array.isArray(data) ? (data as T[]).map(...) : []`
6. **Parse error response bodies before HTTP status** — web apps reuse 403 for both auth and permission errors. The error code in the body distinguishes them.
7. **Icons must be valid Lucide names** — TypeScript catches invalid ones at build time
8. **Biome formatting** — always run `npm run format` after writing code; the project's config may differ from your defaults
9. **The `opentabs` field in `package.json`** is how the platform discovers plugin metadata — `displayName`, `description`, and `urlPatterns` must be there
10. **Browser tools require approval when set to 'ask'** — `browser_navigate_tab`, `browser_execute_script`, etc. show a confirmation dialog when their permission is `'ask'`. Use `skipPermissions` or set tools to `'auto'` during development.
11. **`browser_execute_script` bypasses page CSP** — The tool injects code via a file URL (`chrome.scripting.executeScript({ files: [...] })`), which runs as extension-origin code and is not subject to the page's Content Security Policy. This means `browser_execute_script` works on all pages, including strict-CSP sites like GitHub. The adapter IIFE uses the same file-based injection mechanism — plugin code also bypasses CSP on strict pages.
12. **HttpOnly cookies are invisible to plugin code** — `getCookie()` uses `document.cookie`, which cannot read HttpOnly cookies. Most session cookies are HttpOnly. Always check the cookie `httpOnly` property when exploring auth (use `browser_get_cookies`). For HttpOnly cookie auth, detect auth indirectly: from `<meta>` tags the server embeds in HTML (e.g., `<meta name="user-login">`), from non-HttpOnly indicator cookies (e.g., Notion's `notion_user_id`), from page globals (`window.__APP_STATE__`), or from localStorage. The API calls still work with `credentials: 'include'` because the browser sends HttpOnly cookies automatically — you just can't read them in JS. Auth persistence still matters — persist the *user context* (user ID, workspace ID) on globalThis even when the auth token itself is in HttpOnly cookies. See the "Cookie-Based Auth Pattern" section below.
13. **Cross-origin API + cookies: check CORS before choosing fetch strategy** — When the API is on a different subdomain (e.g., `client-api.example.com` for an `example.com` plugin), verify CORS with `curl -sI -X OPTIONS <api-url> -H "Origin: https://example.com" -H "Access-Control-Request-Method: POST"`. Three outcomes: (a) `allow-origin: https://example.com` + `allow-credentials: true` — direct `fetch()` with `credentials: 'include'` works perfectly; the browser sends HttpOnly cookies and sets correct Origin/Referer headers; this is the ideal path and works for cross-subdomain APIs (same registrable domain); (b) `allow-origin: *` — `credentials: 'include'` is rejected by the browser; use token-based auth extracted from the page instead; (c) no CORS headers — cross-origin requests are blocked; find same-origin internal endpoints. **Always use direct in-page `fetch()` for cookie-based auth** — the adapter runs in the page's MAIN world, so from the browser's perspective it is page JavaScript; `credentials: 'include'` sends cookies just like the web app's own code does.
14. **Scaffolder uses double quotes; Biome wants single quotes** — The `opentabs plugin create` scaffold generates TypeScript with double quotes, but the Biome config uses `quoteStyle: 'single'`. Always run `npm run format` immediately after scaffolding.
15. **Internal API format may differ between endpoints** — The same app may wrap API responses differently across endpoints. Example: Notion's `getRecordValues` returns `block[id].value` (direct), while `queryCollection` returns `block[id].value.value` (extra wrapper with `role` field). Always verify the response shape of each endpoint individually by inspecting the actual response in `browser_execute_script` rather than assuming consistency. Build defensive accessor functions or check both nesting levels.
16. **CRDT-enabled workspaces may reject write operations** — Modern web apps are migrating to CRDTs for real-time collaboration. The older `submitTransaction` API may fail with "User does not have edit access" even on pages the user owns. This is because the CRDT system requires operations in a different format. When write operations fail unexpectedly, check if the app has a CRDT migration flag or a different write endpoint.
17. **`setPersistedToken` must avoid `??=` assignment-in-expression** — The Biome lint rule `noAssignInExpressions` forbids `(obj.prop ??= value)`. Use explicit if-checks instead: `if (!obj.prop) obj.prop = value`.
18. **Scaffolder `package.json` needs manual adjustments** — The scaffold creates a minimal `package.json` that is missing fields that official plugins need: scoped `@opentabs-dev/` package name, matching version with platform, `publishConfig`, `jiti` dev dependency, correct `zod` version matching other plugins. Always compare with an existing plugin's `package.json` and align.
19. **GraphQL APIs may differ between query types** — The same logical field may not exist on all connection types. Example: Linear's `searchIssues` supports `totalCount` but `issues` (the filter-based query) does not. Similarly, `orderBy` enum values vary between connections. Always verify each GraphQL query independently against the live API rather than assuming consistency across query types.
20. **Test every tool against the live browser** — The `opentabs_plugin_list_tabs` tool is the first thing to verify (no confirmation needed). Then systematically test read-only tools (search, list, get) before write tools (create, update, delete). This catches auth issues, API format mismatches, and schema mapping errors early.

---

## Cookie-Based Auth Pattern

For apps where auth is entirely via HttpOnly cookies (no extractable token):

```typescript
// Auth is implicit via credentials: 'include'.
// Detect *authentication status* from observable signals:

const getAuth = (): Auth | null => {
  const persisted = getPersistedAuth();
  if (persisted) return persisted;

  // Check non-HttpOnly cookies for user context
  const userId = getCookie('user_id');
  if (!userId) return null;

  // Resolve workspace/space/org context from localStorage or API
  const contextId = getContextFromLocalStorage();
  const auth: Auth = { userId, contextId: contextId ?? '' };
  setPersistedAuth(auth);
  return auth;
};

// API calls use credentials: 'include' — the browser sends HttpOnly cookies automatically
const api = async <T>(endpoint: string, body: Record<string, unknown>): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated');

  const response = await fetch(`https://app.example.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-active-user': auth.userId,  // Some apps need explicit user headers
    },
    body: JSON.stringify(body),
    credentials: 'include',  // HttpOnly cookies sent automatically
    signal: AbortSignal.timeout(30_000),
  });
  // ... error handling ...
};
```
