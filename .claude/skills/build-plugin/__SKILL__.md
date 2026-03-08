# Build Plugin — Complete Workflow

Build a production-ready OpenTabs plugin. Each phase builds on the previous — do not skip phases.

### Production Quality Standard

**Every plugin you produce must be production-ready, clean, and exemplary.** Your code is a model that other agents and developers will study and learn from. There is no "draft" or "good enough" — when you say the work is done, it is done done: fully reviewed, fully tested, and ready to ship.

**Self-review is not optional and is not a separate step the user must ask for.** Before declaring a plugin complete, you must:

1. **Re-read every file you wrote** — the API wrapper, schemas, every tool file, the plugin class. Read them as if you are seeing them for the first time.
2. **Eliminate dead code** — no unused exports, no unused imports, no unused types, no commented-out code.
3. **Eliminate duplication** — if two schemas share fields, use `.extend()`. If two mappers share logic, compose them. If a pattern repeats across tools, extract a helper.
4. **Verify every function earns its existence** — no functions that extract data nobody uses, no return types with fields no caller reads, no parameters that are always the same value.
5. **Verify consistency** — naming conventions are uniform, all tools follow the same structural pattern, all mappers use the same defensive style.
6. **Run `npm run format` then `npm run check`** — every command must exit 0.

**The standard is simple: could this code be published in official documentation as the canonical example of how to build a plugin?** If the answer is no, it is not done. Fix it before declaring completion.

---

### Prerequisites

**Hot reload mode is strongly recommended for plugin development.** In hot reload mode, the MCP server automatically restarts when plugin code changes, and sends a `tools/list_changed` notification to the MCP client — meaning new tools you build are immediately available to call without restarting or reconnecting. This makes the entire build-test loop seamless.

Hot reload requires running from the cloned repo (not the npm global install):
```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
npm install
npm run dev    # tsc watch + MCP server with hot reload + extension build
```

If the user is running `opentabs start` from the global npm install, tell them: "For the best plugin development experience, I recommend cloning the repo and running `npm run dev` instead — this gives us hot reload so I can build, test, and iterate on tools without any manual restarts."

Before starting, also ensure:
- The Chrome extension is loaded and the side panel is open
- The user has the target web app open in a Chrome tab and is logged in
- **Recommended:** `OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS=1` set to bypass approval prompts during development

---

## Phase 1: Research the Codebase

Study existing infrastructure before writing code:

1. **Plugin SDK** — read `platform/plugin-sdk/CLAUDE.md`. Key concepts:
   - `OpenTabsPlugin` base class: `name`, `displayName`, `description`, `urlPatterns`, `tools`, `isReady()`
   - `defineTool({ name, displayName, description, summary, icon, group, input, output, handle })` factory
   - `ToolError` factories: `.auth()`, `.notFound()`, `.rateLimited()`, `.timeout()`, `.validation()`, `.internal()`
   - All plugin code runs in the **browser page context** (not server-side)
   - Adapters bypass page CSP via file-based injection (`chrome.scripting.executeScript({ files: [...] })`)

**SDK Utilities** (all run in browser page context, `credentials: 'include'` on fetch):

| Category | Functions |
|---|---|
| Fetch | `fetchFromPage`, `fetchJSON`, `postJSON`, `putJSON`, `patchJSON`, `deleteJSON`, `postForm`, `postFormData` — all accept optional Zod schema for response validation |
| DOM | `waitForSelector`, `waitForSelectorRemoval`, `querySelectorAll` (returns array), `getTextContent`, `observeDOM` (MutationObserver, returns cleanup fn) |
| Storage | `getLocalStorage`, `setLocalStorage`, `removeLocalStorage`, `getSessionStorage`, `setSessionStorage`, `removeSessionStorage`, `getCookie` |
| Page State | `getPageGlobal` (dot-notation deep access, e.g., `'app.auth.token'`), `getCurrentUrl`, `getPageTitle` |
| Timing | `sleep`, `retry({ maxAttempts?, delay?, backoff?, maxDelay?, signal? })`, `waitUntil(predicate, { interval?, timeout?, signal? })` |
| Errors | `ToolError` (.auth, .notFound, .rateLimited, .timeout, .validation, .internal), `httpStatusToToolError`, `parseRetryAfterMs` |
| Logging | `log.debug`, `log.info`, `log.warn`, `log.error` — routes through extension to MCP clients |

2. **Study an existing plugin** (e.g., `plugins/github/`) as reference:
   - `src/index.ts` — plugin class, imports all tools
   - `src/*-api.ts` — API wrapper with auth extraction + error classification
   - `src/tools/schemas.ts` — shared Zod schemas + defensive mappers
   - `src/tools/*.ts` — one file per tool
   - `package.json` — the `opentabs` field, dependency versions, scripts

3. **Read `plugins/CLAUDE.md`** — plugin isolation rules and conventions

---

## Phase 2: Explore the Target Web App

The most critical phase. Use browser tools to understand the web app's APIs and auth.

### Core Principle: Use Real APIs, Never the DOM

Every tool must use the web app's own APIs — HTTP endpoints, WebSocket channels, or internal RPC. DOM scraping and HTML parsing are **never acceptable** — they are fragile, limited, slow, and produce unreliable plugins that break on any UI change.

**Only acceptable DOM uses:** `isReady()` auth detection, URL hash navigation, last-resort compose flows (rare).

**If the first round of API discovery only turns up telemetry, analytics, or HTML endpoints, do not give up.** Dig deeper — every non-trivial web app has internal APIs. Try these escalation techniques before concluding a site has no APIs:

1. **Read JavaScript source bundles** — use `browser_list_resources(tabId, type: "Script")` and `browser_get_resource_content` to read the app's JS bundles. Search for API base URLs, endpoint paths, GraphQL queries, and fetch/XHR call patterns. Minified code still contains string literals like `"/api/v1/"`, `"graphql"`, `"mutation"`, etc.
2. **Intercept XHR/fetch at the network level** — enable network capture, then interact with every feature in the app (click buttons, open modals, filter lists, paginate). Many APIs are only called on user interaction, not on page load.
3. **Search for GraphQL** — look for requests to `/graphql`, `/gql`, or request bodies containing `"query"` or `"operationName"`. Modern apps increasingly use GraphQL even when they serve HTML pages.
4. **Check mobile/API subdomains** — try `api.example.com`, `m.example.com`, `mobile-api.example.com`. Mobile apps often use cleaner APIs than the web UI.
5. **Inspect React/Vue/Angular state stores** — use `browser_execute_script` to access `__REACT_DEVTOOLS_GLOBAL_HOOK__`, Vue devtools, or Angular internals to find how the app fetches and stores data.
6. **Monkey-patch fetch/XHR globally** — install interceptors before navigating, then use every feature to capture all network calls with full request/response bodies.

**The AI must exhaust every discovery technique before reporting to the user that a site has no usable APIs.** Never lower the standard by falling back to HTML parsing — instead, report the finding honestly and let the human decide whether to proceed, pivot to a different site, or suggest additional discovery approaches.

### Discovery Workflow

**Start by searching for public API documentation** — web search `<service> API documentation` or `<service> REST API reference`. Many services have comprehensive API docs that map every endpoint, auth method, and response format. This is faster than reverse-engineering from network traffic alone. Use browser tools to supplement, not replace, API docs.

1. **Find the tab**: `plugin_list_tabs` or `browser_list_tabs`

2. **Analyze the site**: `plugin_analyze_site(url: "<target-url>")` — returns auth methods, API endpoints, framework detection, storage keys, tool suggestions

3. **Capture network traffic**:
   ```
   browser_enable_network_capture(tabId, urlFilter: "/api")
   ```
   Navigate the app, then `browser_get_network_requests(tabId)`. Study: API base URL, same-origin vs cross-origin, request format, required headers, response shapes, error format.

4. **Check CORS** (cross-origin APIs only):
   ```bash
   curl -sI -X OPTIONS https://api.example.com/endpoint \
     -H "Origin: <target-url>" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: Authorization,Content-Type" \
     | grep -i "access-control"
   ```

5. **Discover auth** — check cookies first with `browser_get_cookies`, then probe:
   - **Page globals**: `window.gon`, `window.__APP_STATE__`, `window.boot_data`, `window.__NEXT_DATA__`
   - **Webpack module stores**: for React/webpack SPAs, access internal stores via `webpackChunk`
   - **localStorage/sessionStorage**: direct access or iframe fallback
   - **Cookies**: `document.cookie` for non-HttpOnly tokens
   - **Script tags**: inline `<script>` with embedded config

6. **Test the API** via `browser_execute_script`:
   ```javascript
   const resp = await fetch('/api/v2/me', {
     headers: { Authorization: 'Bearer ' + token },
     credentials: 'include',
   });
   return await resp.json();
   ```

7. **Intercept internal traffic** (apps without clean REST APIs) — monkey-patch `XMLHttpRequest` to capture auth headers and internal RPC endpoints. Store on `globalThis` to survive adapter re-injection.

8. **Capture WebSocket traffic** (apps using WebSocket APIs): `browser_get_websocket_frames(tabId)` after enabling network capture.

9. **Map the API surface** — user/profile, list/get/create/update/delete resources, search, messaging, reactions.

10. **Document the raw response shapes** — for every endpoint you plan to use, capture and save the actual JSON response structure. Do not assume field names. The real API may use `id` where you expect `tableId`, nest data under `data.tableDatas` instead of `data.rows`, or use a completely different structure than the one you guess from the endpoint name. Verify by inspecting real responses via `browser_execute_script` before writing any mappers.

11. **Test write endpoints early** — do not assume writes work just because reads do. Some apps route reads through HTTP but writes through WebSocket. Some require extra headers for POST that GET does not need. Call at least one write endpoint during Phase 2 to confirm the write path before designing write tools.

---

## Phase 3: Scaffold the Plugin

```bash
cd plugins/
npx @opentabs-dev/create-plugin <name> --domain <domain> --display <DisplayName> --description "OpenTabs plugin for <DisplayName>"
```

Then align `package.json` with an existing plugin (e.g., `plugins/github/`):
- Package name: `@opentabs-dev/opentabs-plugin-<name>`
- Version: match current platform version
- Dependency versions: match `@opentabs-dev/plugin-sdk` and `@opentabs-dev/plugin-tools`
- Add `publishConfig`, `check` script

---

## Phase 4: Design the Tool Set

**Exhaust the API.** Do not stop at a handful of tools. Cover every API endpoint that a normal or advanced user would need. A production plugin should have 20-40+ tools. A plugin with 5 tools is incomplete.

For every API resource, ask: can the user list, get, create, update, delete, and search it? If the API supports it, add the tool. Then ask: what advanced operations exist? (merge, close, reopen, assign, label, move, archive, export, etc.) Add those too.

Systematic coverage checklist:
- **CRUD for every resource type**: list, get, create, update, delete
- **Search/filter**: search across resources, filter by status/date/label/assignee
- **Relationships**: list items within a parent (e.g., comments on an issue, jobs in a pipeline)
- **State transitions**: close, reopen, merge, archive, approve, reject
- **User operations**: list users/members, get profile, get current user
- **Interactions**: reactions, pins, bookmarks, votes, stars, follows
- **Content retrieval**: get file content, get diffs, get logs, get raw output
- **Platform-specific**: threads, DMs, file uploads, webhooks, pipelines, deployments, etc.

Only omit an endpoint if it requires capabilities the adapter cannot provide (e.g., binary file upload with no API support) or it is genuinely dangerous with no undo (e.g., delete organization).

**Completeness check:** Count your planned tools before moving to Phase 5. If under 15, go back and look for more API endpoints — you almost certainly missed something. For a service with a rich API (e.g., GitHub, GitLab, Slack, Jira), expect 20-40+ tools.

---

## Phase 5: Implement

### File Structure

```
src/
  index.ts              # Plugin class, imports all tools, implements isReady()
  <name>-api.ts         # API wrapper: auth extraction + error classification
  tools/
    schemas.ts          # Shared Zod schemas + defensive mappers
    <tool-name>.ts      # One file per tool
```

### API Wrapper (`<name>-api.ts`)

```typescript
import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://example.com/api';

const getAuth = (): { token: string } | null => {
  // 1. Check globalThis persistence (survives re-injection)
  // 2. Try localStorage, page globals, cookies
  // Return null if not authenticated
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 500;
      if (isAuthenticated()) { clearInterval(timer); resolve(true); return; }
      if (elapsed >= 5000) { clearInterval(timer); resolve(false); }
    }, 500);
  });

export const api = async <T>(endpoint: string, options: {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
} = {}): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  let url = `${API_BASE}${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query))
      if (v !== undefined) params.append(k, String(v));
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  // CSRF token for mutating requests (cookie-based auth)
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method, headers, body: fetchBody,
      credentials: 'include', signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`Timed out: ${endpoint}`);
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`,
      'network_error', { category: 'internal', retryable: true });
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw ToolError.rateLimited(`Rate limited: ${endpoint}`, retryAfter ? parseRetryAfterMs(retryAfter) : undefined);
    }
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${body}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint}`);
    if (response.status === 422) throw ToolError.validation(`Validation error: ${body}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${body}`);
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
import { messageSchema, mapMessage } from './schemas.js';

export const sendMessage = defineTool({
  name: 'send_message',
  displayName: 'Send Message',
  description: 'Send a message to a channel. Supports markdown.',
  summary: 'Send a message to a channel',
  icon: 'send',
  group: 'Messages',
  input: z.object({
    channel: z.string().describe('Channel ID'),
    content: z.string().describe('Message text'),
  }),
  output: z.object({ message: messageSchema }),
  handle: async (params, context?) => {
    // context?.reportProgress({ progress: 1, total: 2, message: 'Sending...' });
    const data = await api<Record<string, unknown>>(
      `/channels/${params.channel}/messages`,
      { method: 'POST', body: { content: params.content } },
    );
    return { message: mapMessage(data) };
  },
});
```

### Plugin Class (`index.ts`)

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
  override readonly homepage = 'https://example.com';
  readonly tools: ToolDefinition[] = [sendMessage];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new MyPlugin();
```

### Schemas and Defensive Mappers (`tools/schemas.ts`)

Define Zod schemas for output types and mapper functions that handle missing/null fields:

```typescript
export const messageSchema = z.object({
  id: z.string().describe('Message ID'),
  text: z.string().describe('Message text'),
  author: z.string().describe('Author username'),
  created_at: z.string().describe('ISO 8601 timestamp'),
});

interface RawMessage { id?: string; text?: string; author?: { username?: string }; created_at?: string; }

export const mapMessage = (m: RawMessage) => ({
  id: m.id ?? '',
  text: m.text ?? '',
  author: m.author?.username ?? '',
  created_at: m.created_at ?? '',
});
```

---

## Phase 6: Icon

### Finding the Icon

**Try Simple Icons first** — it covers 3000+ brands with consistent, clean SVGs under CC0 license:

```
https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/<name>.svg
```

Fetch the SVG, then clean it up: remove `role="img"` and `<title>`, add `fill="black"`.

If the service is not in Simple Icons, web search for the service's official brand SVG logo. Prefer the **dark/black** variant for `icon.svg` (light mode has a light background).

If you cannot find a suitable SVG from either source, skip the icon. The system provides a default letter avatar. Tell the user they can provide a high-quality logo SVG later.

### SVG Requirements

| Rule | Detail |
|---|---|
| Icon-only | No wordmark, no text, just the logo mark |
| Real vector | Must contain `<path>`, `<circle>`, etc. — reject raster PNGs wrapped in `<svg><image>` |
| Inline fills | `fill="..."` on elements, not CSS classes in `<style>` (build strips `<style>`) |
| Square viewBox | Non-square `0 0 W H` where `W > H` → `viewBox="0 -(W-H)/2 W W"` |
| No width/height | Remove `width`, `height` from `<svg>` — let it scale |
| Under 8KB | Remove comments, metadata, redundant `<g>` wrappers |
| Tight crop | Adjust viewBox to tightly fit the paths if there's empty space |
| No forbidden elements | No `<image>`, no `<script>`, no event handlers (`onclick`, `onload`, etc.) |

### Icon Variants

| File | Purpose | If absent |
|---|---|---|
| `icon.svg` | Light mode active | Letter avatar fallback |
| `icon-inactive.svg` | Light mode inactive (must be achromatic) | Auto-generated grayscale |
| `icon-dark.svg` | Dark mode active | Auto-generated (inverts low-contrast colors against `#242424`) |
| `icon-dark-inactive.svg` | Dark mode inactive | Auto-generated grayscale of dark variant |

Provide explicit `icon-dark.svg` when the brand has official light/dark variants or auto-generation is unsatisfactory.

**Verify SVG content before using.** Some brands use "dark" and "light" to mean the background color, not the icon color — a file named "logo-dark" may contain a white icon (designed for dark backgrounds), which is the opposite of what you need. Always open/inspect the SVG to confirm the actual fill colors match the intended use: `icon.svg` needs a dark-colored icon (for light backgrounds), `icon-dark.svg` needs a light-colored icon (for dark backgrounds).

### Placement

Place as `plugins/<name>/icon.svg` (and optional variants). Build auto-generates missing variants.

---

## Phase 7: Build and Test

### Build

```bash
cd plugins/<name>
npm install
npm run build     # tsc + opentabs-plugin build
npm run check     # build + type-check + lint + format:check
```

Every command must exit 0. Use `opentabs-plugin build --watch` for iterative development. Use `opentabs-plugin inspect` to verify the built manifest (tool count, schemas).

### Enable the Plugin

New plugins start with permission `off`. Before testing, enable it:

1. Verify plugin loaded: `plugin_list_tabs(plugin: "<name>")` — must show `state: "ready"`
2. Ask the user: "I just built this plugin — can I enable it for testing?"
3. On approval, call `plugin_inspect(plugin: "<name>")` to get the review token
4. Call `plugin_mark_reviewed(plugin: "<name>", version: "<version>", reviewToken: "<token>", permission: "auto")` to enable all tools

If `skipPermissions` is already set, this step is unnecessary.

### Mandatory Tool Verification

**The plugin is not done until every tool has been called against the live browser.**

**If running in hot reload mode (`npm run dev`):** After `npm run build` in the plugin directory, the MCP server detects the change, reloads plugins, and sends `tools/list_changed` to the MCP client. The new `<plugin>_*` tools should appear in your tool list immediately — just call them directly like any other MCP tool. This is the expected workflow.

**If hot reload is not working or tools don't appear:** Fall back to raw HTTP calls to the MCP Streamable HTTP endpoint:

```bash
SECRET=$(cat ~/.opentabs/extension/auth.json | python3 -c "import json,sys;print(json.load(sys.stdin)['secret'])")
PORT=$(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep node | awk '{print $9}' | grep -o '[0-9]*$' | head -1)

# Initialize session (extract Mcp-Session-Id from response headers)
curl -s -D - -X POST http://127.0.0.1:$PORT/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Call a tool (replace SESSION_ID, tool name, and arguments)
curl -s -X POST http://127.0.0.1:$PORT/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $SECRET" -H "Mcp-Session-Id: <SESSION_ID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<plugin>_<tool>","arguments":{...}}}'
```

**Test every tool:**

1. Call every read-only tool — verify real data with correct field mappings. If a tool returns empty results when you know data exists, the response shape assumption is wrong. Use `browser_execute_script` to fetch the raw JSON and compare actual field names against your interface definitions.
2. Call every write tool with round-trip tests (create → verify → update → delete → verify)
3. Test error classification — call with invalid ID, verify `ToolError.notFound`
4. Fix every failure — use `browser_execute_script` to inspect raw API responses

Remove tools you cannot verify rather than shipping them broken.

### Mandatory Self-Review Before Completion

**Do not wait for the user to ask you to review your code.** After all tools are tested and passing, perform a final self-review pass before declaring the plugin done:

1. Re-read every source file — API wrapper, schemas, all tool files, plugin class
2. Delete dead code: unused exports, unused imports, unused types
3. Eliminate duplication: shared fields use `.extend()`, shared mapper logic uses spread composition
4. Verify every export is consumed, every function parameter is used, every return field is read
5. Run `npm run format` then `npm run check` — all must exit 0
6. Verify the code is clean enough to serve as a reference implementation for other agents to learn from

**When you say "done", the plugin is production-ready. No cleanup pass needed. No review requested. Done means done.**

---

## Phase 8: Write Learnings Back

**This phase is mandatory, not optional.** After all tools pass testing, explicitly evaluate your session for reusable knowledge. You must **show your reasoning to the user** — even if the conclusion is "nothing new to contribute."

### Evaluation Checklist

Walk through each category below. For each, state what you encountered and whether it's new:

1. **Auth pattern** — How did you detect authentication? How did you extract CSRF tokens? Was this pattern already documented in "Auth Patterns" below? If not, add it.
2. **API discovery technique** — Did you use a new approach to find endpoints (e.g., reading webpack chunks, intercepting WebSocket frames, probing undocumented paths)? Is this technique already in Phase 2? If not, add it.
3. **Error classification** — Did the API return errors in an unusual way (e.g., 403 for permissions vs auth, error objects nested in 200 responses, error codes in response bodies)? Is this covered by existing gotchas? If not, add a gotcha.
4. **Schema/typing pattern** — Did you discover a Zod pattern, defensive mapper technique, or TypeScript workaround that other plugins would benefit from? Is this in "Conventions"? If not, add it.
5. **Architectural constraint** — Did you hit a limitation of the browser environment, API transport, or platform that affected your design? Is this in "Gotchas"? If not, evaluate if it's generic enough to add.
6. **Platform improvement** — Did you work around a missing SDK utility, build tool limitation, or MCP server bug? These do NOT go in the skill file — report them to the user as action items.

### Output format

Tell the user what you found. Example:

> **Phase 8 — Learnings evaluation:**
> - Auth: HttpOnly cookies + CSRF from `window.initData` — already covered by Auth Patterns > Session Cookies. No change needed.
> - API: Found that writes go through WebSocket, not HTTP — new generic pattern. Added as gotcha #18.
> - Errors: API uses 403 for both auth and permission — already gotcha #6. No change needed.
> - No new schema patterns or platform issues to report.

If everything was already documented, say so explicitly. Do not silently skip this phase.

### What belongs in this skill file

Update `.claude/skills/build-plugin/__SKILL__.md` directly with:

| What you learned | Where to add it |
|---|---|
| New auth pattern (cookie, header interception, window globals) | "Auth Patterns" section below |
| New API discovery technique | Phase 2 above |
| New Zod schema pattern | "Conventions" section below |
| New architectural constraint | "Gotchas" section below |

### What qualifies as a gotcha

Gotchas are **immutable constraints** that the platform cannot fix — they are facts of the browser environment, web standards, or third-party API behavior. Before adding a gotcha, ask: "Can this be fixed by improving the SDK, build tool, or MCP server?" If yes, it is not a gotcha — tell the user to file an issue or PR to improve the platform instead.

A gotcha must also be **generic** — it applies to any plugin, not just one specific website. If you found a site-specific workaround, ask: "Can this solution be generalized for other plugins?" If yes, extract the generic pattern and add it. If it's purely site-specific, do not add it.

### What should be reported to the user instead

If you discover:
- A missing SDK utility that would help many plugins → tell the user to create a PR adding it to `platform/plugin-sdk/`
- A build tool limitation that could be fixed → tell the user to file an issue
- A bug in the MCP server, extension, or adapter injection → tell the user to file an issue
- A site-specific quirk with no generic solution → document it in a comment in that plugin's code, not here

Rules: check for duplicates first, keep learnings generic, verify the file is valid markdown.

---

## Conventions

### Tool Quality Standards

Every tool has two audiences: **AI agents** consume `description`, `input`, and `output` (via JSON Schema). **Humans** see `displayName`, `summary`, `icon`, and `group` in the side panel.

**Every `defineTool` field must be populated — no exceptions:**

| Field | Audience | Requirements |
|---|---|---|
| `name` | Both | snake_case, descriptive (e.g., `list_merge_requests`, not `list_mrs`) |
| `displayName` | Human | Clean title for side panel (e.g., "List Merge Requests") |
| `description` | AI | Detailed: what the tool does, what it returns, constraints, default behavior, edge cases. This is the primary way AI agents decide whether and how to use a tool. Include return value semantics. |
| `summary` | Human | Short label under 80 chars for side panel UI |
| `icon` | Human | Relevant Lucide icon in kebab-case |
| `group` | Human | Logical category for side panel grouping (e.g., "Issues", "CI/CD", "Users") |
| `input` | AI | Zod object schema — every field with `.describe()` |
| `output` | AI | Zod schema — every field with `.describe()` |

**Zod `.describe()` is mandatory on every single field** — input and output. These descriptions become the JSON Schema that AI agents read. A field without `.describe()` is opaque to the AI — it cannot correctly populate inputs or interpret outputs.

Write descriptions that are **accurate, specific, and informational**:
- "Issue IID (project-scoped numeric ID, different from global ID)" not "Issue ID"
- "ISO 8601 timestamp (e.g., 2024-01-15T10:30:00Z)" not "date"
- "Comma-separated list of label names to filter by" not "labels"
- "Results per page (default 20, max 100)" not "page size"
- "Pipeline status (e.g., running, success, failed, canceled, pending)" not "status"

Zod types must be precise: use `.int()` for integer fields, `.min()`/`.max()` for bounds, `.optional()` for non-required fields, `.describe()` for defaults. Use `z.enum()` for known value sets.

### Code Conventions

- One file per tool in `src/tools/`
- Defensive mapping with fallback defaults (`data.field ?? ''`) — never trust API shapes
- `credentials: 'include'` on all fetch calls
- 30-second timeout via `AbortSignal.timeout(30_000)`
- `.js` extension on all imports (ESM)
- No `.transform()`/`.pipe()`/`.preprocess()` in Zod schemas (breaks JSON Schema serialization)
- `.refine()` callbacks must never throw — Zod 4 runs them even on invalid base values

### Consistency Rules for Multi-Tool Plugins

When building plugins with 15+ tools, inconsistency across files is the primary quality problem. Establish these patterns in `schemas.ts` **before** writing any tool files, then follow them rigidly:

1. **Define shared API response types in `schemas.ts`** — e.g., `AsanaResponse<T>` for single-item endpoints, `AsanaList<T>` for paginated lists. Every tool file imports and uses these instead of declaring local `interface RawResponse { data: ... }` variants.

2. **Export all Raw interfaces from `schemas.ts`** — `RawTask`, `RawProject`, etc. Tool files import them. Never redeclare a Raw interface locally in a tool file. This prevents N copies of the same interface drifting apart.

3. **Define OPT_FIELDS constants for every entity** — if an API requires explicit field selection (like Asana's `opt_fields`), define a constant for each entity type (`TASK_OPT_FIELDS`, `PROJECT_OPT_FIELDS`, `SECTION_OPT_FIELDS`, etc.) in `schemas.ts`. Pass it from every endpoint that returns that entity, including POST/PUT responses. Missing `opt_fields` causes silently incomplete data.

4. **Use one variable name for API responses** — pick `data` and use it everywhere. Not `result` in some files and `res` in others.

5. **Handle pagination the same way in every list tool** — put `offset: params.offset` directly in the query object (the API helper skips `undefined` values). Do not use `if (params.offset !== undefined)` conditionals in some files and direct assignment in others.

6. **Never use type casts to work around API typing** — if you need `as Parameters<typeof mapProject>[0]`, the generic type parameter to `api<T>()` is wrong. Fix the type, don't cast.

### Code Cleanliness

Plugin code serves as a learning reference for other agents and developers. Every file must be clean, tidy, and self-evident:

- **No dead exports** — if a schema, type, or function is not imported anywhere, delete it
- **No duplication** — use `.extend()` for Zod schema inheritance, spread for mapper composition (`...mapTag(t)`)
- **API wrapper exports only what tools need** — do not extract auth fields (fkey, CSRF tokens, account IDs) unless a tool actually uses them
- **SEResponse type is minimal** — only include fields the tools actually read (items, has_more, quota_remaining), not the full API spec
- **Mappers reuse each other** — if `tagInfoSchema` extends `tagSchema`, then `mapTagInfo` should spread `mapTag(t)` and add extra fields, not repeat all fields manually
- **No inline fallback objects** — if a mapper already provides safe defaults for all fields, call the mapper with an empty object (`mapUser(data ?? {})`) instead of writing a 15-line manual default
- **Consistent structure across tools** — every list tool returns `{ items, has_more, quota_remaining }`, every get tool returns `{ item }`, every search tool returns `{ results, has_more, quota_remaining }`. Structural consistency makes the plugin predictable.
- **Import only what you use** — no `import type { SEResponse }` if the tool never references that type directly

---

## Auth Patterns

### Session Cookies (most common)
Apps using HttpOnly session cookies: use `credentials: 'include'`, detect auth via page globals or DOM signals. Auth detection sources include: non-HttpOnly indicator cookies (check `document.cookie`), base64-encoded profile cookies (e.g., `atob(cookieValue)` → `{ firstName, email }` confirms login state), page globals, or DOM signals. Mutating requests often need a CSRF token — check three sources: `<meta name="csrf-token">` tag, non-HttpOnly cookies, or bootstrap globals (e.g., `window.initData.csrfToken`). The CSRF value is typically sent as a header (`X-CSRF-Token`) or a body field (`_csrf`).

### Bearer Tokens
Extract from localStorage, sessionStorage, page globals (`window.__APP_STATE__`, `window.boot_data`), or intercepted XHR headers. Cache on `globalThis.__openTabs.tokenCache.<pluginName>` to survive adapter re-injection (module-level variables reset on extension reload). Clear on 401 to handle rotation.

### XHR/Fetch Interception
For apps with internal RPC or obfuscated APIs: monkey-patch `XMLHttpRequest.prototype.open/setRequestHeader/send` at adapter load time to capture auth headers. Store on `globalThis`. Re-patch on each adapter load (avoid stale `if (installed) return` guards).

### First-Party API Headers
Some apps (e.g., Asana) use HttpOnly cookie auth where GET requests work automatically with `credentials: 'include'` but POST/PUT/DELETE requests return 401 unless a specific first-party header is present. Look in CORS `Access-Control-Allow-Headers` for custom headers like `X-Allow-Asana-Client`, `X-Requested-With`, or similar. These are not CSRF tokens — they are gate headers that distinguish first-party app requests from third-party API calls. The header value is typically a static string (`'1'`). Check the CORS response headers during Phase 2 network analysis.

### Opaque Auth Headers
Some apps compute cryptographic tokens via obfuscated JS — capture and replay, don't generate. Poll with timeout for the header to appear.

---

## Gotchas

1. All plugin code runs in the browser — no Node.js APIs
2. SPAs hydrate asynchronously — `isReady()` must poll (500ms interval, 5s max)
3. Some apps delete `window.localStorage` — use iframe fallback
4. Module-level variables reset on extension reload — persist tokens on `globalThis.__openTabs.tokenCache.<pluginName>`
5. HttpOnly cookies are invisible to JS — use `credentials: 'include'`, detect auth from DOM/globals
6. Parse error response bodies before classifying by HTTP status — many apps reuse 403 for auth vs permission
7. Cross-origin API + cookies: check CORS before choosing fetch strategy
8. Always run `npm run format` after writing code — Biome uses single quotes
9. Adapters inject at `loading` (before page JS) and `complete` (after full load) — cache tokens from localStorage early before the host app deletes them
10. Cookie-based auth often requires CSRF tokens for writes — check meta tags, bootstrap globals, or non-HttpOnly cookies
11. Check bootstrap globals (`window.__initialData`, `window.gon`, `window.__INITIAL_STATE__`) for auth signals — more reliable than DOM
12. Some apps use internal same-origin APIs with cookie auth while the public API requires OAuth2 — look for internal endpoints
13. Trusted Types CSP blocks `innerHTML` — use `html.replace(/<[^>]+>/g, '')` for HTML-to-text
14. When one API path is blocked, explore internal extension APIs, `webpackChunk`-based module access, or programmatic interfaces on `window`
15. Internal API endpoints can be deprecated without warning — test each endpoint independently, remove broken tools
16. When using sub-agents to write tool files in parallel, define ALL shared types (Raw interfaces, response envelope types, OPT_FIELDS constants) in `schemas.ts` **before** dispatching tool file generation — otherwise each agent invents its own local types and you end up rewriting everything for consistency
17. Some APIs authorize GET and POST differently — GET may work with just cookies while POST requires an additional header. Always test both read and write operations during Phase 2 discovery, not just reads
18. Some apps split read vs write across different transports — HTTP for reads, WebSocket for mutations. If POST endpoints for creating/updating resources all return 404 but the app clearly works, capture WebSocket frames to find the mutation protocol. In this case, cell-level update endpoints may exist via HTTP (e.g., `updatePrimitiveCell`) while row creation is WebSocket-only. Document which operations are available via HTTP vs WebSocket-only in Phase 4 and only build tools for HTTP-accessible endpoints
19. Some apps require a cryptographic per-request header (e.g., `x-client-transaction-id`) generated by obfuscated JS. Endpoints requiring this header return 404 (not 401/403) when it's missing, making the failure look like a wrong URL rather than missing auth. During Phase 2, test each endpoint individually via `browser_execute_script` — if a request works when the browser makes it naturally but fails when you replay it from JS with the same URL and auth, a signed header is likely required. Remove tools for these endpoints rather than shipping broken ones
20. SPAs with micro-frontend (MFE) architectures manage shared state (cart, notifications, user profile) through XState state machines communicating via `BroadcastChannel`. After API mutations that modify shared state, broadcast the appropriate event (e.g., `{type: "SYNC_CART"}` on `cart_channel`) to tell the frontend to re-read from the backend — this keeps the browser UI in sync with API changes without requiring a page reload. During Phase 2, listen on broadcast channels while using the UI to discover the exact event names and formats
21. SPAs write their own session state to cookies (e.g., `cartId`, `storeId`, `serviceMethod`). Plugin tools that modify shared resources must read from the frontend's own cookies and operate on the same IDs the browser is displaying — creating separate API-side state causes the frontend and API to diverge. When the plugin needs to create state (e.g., a new cart), it must also write the same cookies the frontend reads (using `document.cookie`), so the browser recognizes the state on the next navigation. During Phase 2, compare cookie names used by the frontend (visible in `document.cookie`) against any cookies the API creates to identify the correct cookie names
22. Apps using Apollo-style persisted GraphQL queries map each operation to a sha256 hash that changes on every app deployment. Plugin tools hardcoding these hashes will silently break when the target app deploys a new client version — the server returns `persisted_query_not_found` (HTTP 400). Detect this specific error in the API wrapper and return a clear message (e.g., "Persisted query hash expired — Airbnb may have deployed a new client version"). During Phase 2, verify hashes work via `browser_execute_script` fetch calls, and prefer endpoints that use stable query identifiers (operation name only, REST paths) over hash-dependent persisted queries when both are available
23. SPAs using Redux persist (or similar localStorage-backed state management) flush their in-memory store to `localStorage` during page teardown (`beforeunload`). Writing to `persist:root` before navigating is unreliable — the SPA's flush overwrites the write. To inject state reliably: stash the desired state in a **separate localStorage key** (e.g., `__opentabs_pending_<resource>`), navigate, then at adapter IIFE load time check for the pending key, apply it to `persist:root`, remove the pending key, and call `window.location.reload()`. The second load has no pending key (no loop), and the SPA hydrates with the correct data. Run the pending-state application at **module scope** in `index.ts` (not in `isReady()`) and guard with `typeof localStorage === 'undefined'` for Node.js build compatibility
24. Adapter IIFEs run at `document_idle` — after the SPA's scripts have already hydrated from `localStorage`. The adapter cannot write to `persist:root` and expect the running SPA to pick it up. Any tool that needs to sync state into the SPA's store must use the pending-stash-and-reload pattern from gotcha #23, or find a way to dispatch actions into the SPA's live store (e.g., accessing the Redux store via React devtools hooks or page globals)

---

## Troubleshooting

### Quick Diagnosis

```
extension_get_state                   # Extension health, WebSocket status
plugin_list_tabs                      # Per-plugin tab readiness
extension_get_logs                    # Adapter injection, dispatch errors
browser_get_console_logs(tabId)       # JS errors in target web app
opentabs doctor                       # Comprehensive setup diagnostics with fix suggestions
opentabs logs --plugin <name>         # Server-side plugin-specific logs
```

### Common Errors

| Error | Cause | Fix |
|---|---|---|
| Extension not connected | Extension not loaded or side panel closed | Reload extension at `chrome://extensions/`, open side panel |
| Tab closed | No matching tab open | Open the web app in Chrome |
| Tab unavailable | Not logged in or page loading | Log in, wait, re-check with `plugin_list_tabs` |
| Plugin not reviewed | Permission is `off` | `plugin_inspect` → review code → `plugin_mark_reviewed` |
| Tool disabled | Tool permission is `off` | `opentabs config set tool-permission.<plugin>.<tool> ask` |
| Permission denied | User rejected approval | Do NOT retry immediately. Ask user, then `opentabs config set plugin-permission.<plugin> auto` |
| Dispatch timeout | 30s default; progress extends by 30s each; 5min ceiling | Use `context.reportProgress()` for long ops, or break into multiple calls |
| Rate limited | API throttling (429) | Wait `retryAfterMs`, reduce call frequency |
| Tool not found | Wrong name or plugin not loaded | Format: `<plugin>_<tool>`, verify with `plugin_list_tabs` |
| Concurrent dispatch limit | 5 active per plugin | Wait for in-flight tools to complete |
| Schema validation error | Wrong argument types | Check tool input schema via `tools/list` |

### Detailed Diagnostics

1. **Extension not connecting**: Verify server running (`opentabs status`), extension enabled at `chrome://extensions/`, side panel open. Try `opentabs config rotate-secret --confirm` then reload extension.
2. **Plugin not loading**: Check `opentabs logs --plugin <name>` for discovery errors. Verify `dist/adapter.iife.js` and `dist/tools.json` exist.
3. **Auth failing**: Use `browser_get_cookies` and `browser_execute_script` to inspect the page's auth state. Check if tokens are in localStorage, page globals, or intercepted headers.
4. **Network issues**: `browser_enable_network_capture(tabId, urlFilter: "/api")`, reproduce the issue, then `browser_get_network_requests(tabId)` to inspect failed requests.

---

## Plugin Setup Reference

### Installing an Existing Plugin

```bash
opentabs plugin search <name>        # Find on npm
opentabs plugin install <name>       # Install globally
```

For local plugins under development outside `plugins/`:
```bash
opentabs config set localPlugins.add /path/to/plugin
```

Open the target web app in Chrome. The extension detects the matching tab automatically.

### Plugin Review Flow

New plugins start with permission `off`. When a tool is called on an unreviewed plugin:
1. `plugin_inspect(plugin: "<name>")` — retrieves adapter source + review token
2. Review code for security (network requests, data access, DOM manipulation)
3. `plugin_mark_reviewed(plugin, version, reviewToken, permission: "ask" | "auto")`

Updated plugins reset to `off` and require re-review.

### Permission Configuration

```bash
opentabs config set plugin-permission.<plugin> ask|auto|off
opentabs config set tool-permission.<plugin>.<tool> ask|auto|off
```

Resolution order: `skipPermissions` env → per-tool override → plugin default → `off`.
