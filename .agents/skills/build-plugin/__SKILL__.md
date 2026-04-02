# Build Plugin — Complete Workflow

Build a production-ready OpenTabs plugin. Each phase builds on the previous — do not skip phases.

### Production Quality Standard

**Every plugin you produce must be production-ready, clean, and exemplary.** Your code is a model that other agents and developers will study and learn from. There is no "draft" or "good enough" — when you say the work is done, it is done done: fully reviewed, fully tested, and ready to ship.

**Plugin self-sufficiency is non-negotiable.** A plugin adapter must be able to complete any task entirely on its own — through its own tools, using SDK utilities and the site's APIs. Browser tools (`browser_execute_script`, `browser_click_element`, etc.) are development aids for testing and debugging during the build process. They are NOT part of the plugin's runtime capabilities. Users may disable browser tools entirely during normal use, and the AI agent must still be able to accomplish every workflow using only the plugin's tools. If a workflow requires browser interaction (e.g., clicking a checkout button), the plugin must expose a tool that does it programmatically via the site's API or DOM manipulation within the adapter — not rely on the agent calling a browser tool.

**Self-review is mandatory and automatic** — do not wait for the user to ask. See Phase 8 "Mandatory Self-Review Before Completion" for the full checklist. The standard: could this code be published as the canonical example of how to build a plugin? If not, fix it.

**Plugins must be generic — no personal information, no organization-specific content.** Plugins are published as npm packages and shared publicly. Every piece of source code, comment, description, schema, tool name, example value, and commit message must be completely free of:

- **Organization names** — never reference the test account's company, team, or workspace name (e.g., "Acme Corp", "my-company.slack.com") in source code or comments
- **Account identifiers** — no real user IDs, team IDs, enterprise IDs, channel IDs, workspace URLs, or API tokens observed during testing
- **Personal information** — no real names, email addresses, or usernames from the test environment
- **Test data artifacts** — no sample responses, example IDs, or debug output copied from live API calls into comments or descriptions

Use generic placeholders in descriptions and examples: `C1234567890` for channel IDs, `U1234567890` for user IDs, `example.com` for domains. If you observe real data during browser exploration (Phase 2), that data must never appear in the plugin source — it is ephemeral context for understanding the API, not content to copy.

**Pre-commit PII scan**: Before committing, grep the entire plugin directory for organization names, real IDs, and email patterns observed during the session. If anything leaks through, fix it before staging.

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
- **Recommended:** Ask human to make the browser tools in auto mode

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
| Fetch | `fetchFromPage`, `fetchJSON`, `fetchText`, `postJSON`, `putJSON`, `patchJSON`, `deleteJSON`, `postForm`, `postFormData` — all accept optional Zod schema for response validation. `buildQueryString` for URL parameter construction. `httpStatusToToolError` for HTTP status → ToolError mapping. `parseRetryAfterMs` for Retry-After header parsing. |
| DOM | `waitForSelector`, `waitForSelectorRemoval`, `querySelectorAll` (returns array), `getTextContent`, `getMetaContent` (reads `<meta>` tag content by name), `observeDOM` (MutationObserver, returns cleanup fn) |
| Storage | `getLocalStorage`, `setLocalStorage`, `removeLocalStorage`, `getSessionStorage`, `setSessionStorage`, `removeSessionStorage`, `getCookie`, `findLocalStorageEntry` (search keys by predicate) |
| Auth Cache | `getAuthCache<T>(namespace)`, `setAuthCache<T>(namespace, value)`, `clearAuthCache(namespace)` — persist tokens to `globalThis.__openTabs.tokenCache` to survive adapter re-injection |
| Page State | `getPageGlobal` (dot-notation deep access, e.g., `'app.auth.token'`), `getCurrentUrl`, `getPageTitle` |
| Timing | `sleep`, `retry({ maxAttempts?, delay?, backoff?, maxDelay?, signal? })`, `waitUntil(predicate, { interval?, timeout?, signal? })` |
| Errors | `ToolError` (.auth, .notFound, .rateLimited, .timeout, .validation, .internal), `httpStatusToToolError`, `parseRetryAfterMs` |
| Logging | `log.debug`, `log.info`, `log.warn`, `log.error` — routes through extension to MCP clients |

### SDK-First Rule (Mandatory)

**You MUST use SDK utilities for every operation they cover. Never reimplement functionality that the SDK already provides.** This is not a suggestion — it is a hard requirement. Every plugin that manually reimplements SDK functionality creates maintenance debt and inconsistency.

| Operation | MUST use | NEVER do |
|---|---|---|
| Auth polling | `waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 })` | Manual `setInterval` + elapsed counter |
| Token persistence | `getAuthCache<T>(name)` / `setAuthCache(name, value)` / `clearAuthCache(name)` | Manual `globalThis.__openTabs.tokenCache` access |
| Cookie reading | `getCookie(name)` | Manual `document.cookie.split()` or `.match()` |
| localStorage reading | `getLocalStorage(key)` | Direct `localStorage.getItem(key)` |
| Page globals | `getPageGlobal('path.to.value')` | Manual `(window as any).path.to.value` casts |
| Meta tags | `getMetaContent('meta-name')` | Manual `document.querySelector('meta[name="..."]')` |
| HTTP error mapping | `httpStatusToToolError(response, msg)` | Manual `if (status === 429) ... if (status === 401) ...` chains |
| JSON fetch | `fetchJSON(url, init)` or `postJSON(url, body, init)` | Manual `fetch()` + `response.json()` + error handling |
| FormData/custom body | `fetchFromPage(url, init)` — handles credentials, timeout, and throws `httpStatusToToolError` on non-ok responses | Manual `fetch()` + `credentials: 'include'` + `AbortSignal.timeout()` + manual error chain |
| Text fetch | `fetchText(url, init)` | Manual `fetch()` + `response.text()` |
| Query strings | `buildQueryString({ page: 1, limit: 20 })` | Manual `URLSearchParams` construction |
| Search localStorage | `findLocalStorageEntry(key => key.includes('token'))` | Manual `for (let i = 0; i < localStorage.length; i++)` loops |

If the SDK utility doesn't cover your exact use case (e.g., the API needs custom headers beyond what `fetchJSON` supports), use `fetchFromPage` as the base and compose SDK utilities on top — never bypass the SDK entirely.

2. **Study an existing plugin** (e.g., `plugins/github/`) as reference for file structure and tool patterns:
   - `src/index.ts` — plugin class, imports all tools
   - `src/*-api.ts` — API wrapper with auth extraction + error classification
   - `src/tools/schemas.ts` — shared Zod schemas + defensive mappers
   - `src/tools/*.ts` — one file per tool
   - `package.json` — the `opentabs` field, dependency versions, scripts

   **This skill is the source of truth, not existing plugin code.** If a reference plugin contradicts the SDK-First Rule or the templates in this skill, follow the skill. Existing plugins may contain legacy patterns that have not been updated yet.

3. **Read `plugins/CLAUDE.md`** — plugin isolation rules and conventions

---

## Phase 2: Explore the Target Web App

The most critical phase. Use browser tools to understand the web app's APIs and auth.

### Core Principle: Authenticated APIs Only

**Never use unauthenticated public APIs when the user is logged in.** If a site has a public API (e.g., `api.github.com`) that uses CORS `Access-Control-Allow-Origin: *` (which blocks `credentials: 'include'`), that API is unauthenticated — it cannot access private repos, private data, or perform write operations. The plugin MUST use same-origin authenticated endpoints instead. A plugin that defaults to unauthenticated API calls is fundamentally broken — it gives the illusion of working while silently failing on any private or enterprise content.

During Phase 2, verify early: can you `fetch()` the public API with `credentials: 'include'`? If the browser throws a CORS TypeError or the response lacks the user's private data, that API is unauthenticated. Switch immediately to same-origin discovery. The same-origin API surface is always richer than the public API because the web app itself uses it.

### Core Principle: Use Real APIs, Never the DOM

Every tool must use the web app's own APIs — HTTP endpoints, WebSocket channels, or internal RPC. DOM scraping and HTML parsing are **never acceptable** as the primary data source — they are fragile, limited, slow, and produce unreliable plugins that break on any UI change.

**Absolute prohibitions:**
- **Never navigate the page inside a tool handler** (`window.location.href = ...`). Page navigation destroys the adapter's JavaScript execution context — the handler's promises, callbacks, and polling loops are killed mid-flight, causing the tool to time out or return empty. Navigation tools (`navigate_to_*`) work because they return immediately before the navigation takes effect — they do not attempt to read data after navigating. Any tool that needs to both navigate AND extract data is architecturally broken.
- **Never poll the DOM for data** (`document.querySelectorAll` in a retry loop waiting for elements to appear). This couples the plugin to the site's HTML structure, which changes without warning.
- **Never use `document.querySelectorAll` to extract product data, search results, or API responses** from rendered HTML. If the data is in the DOM, it came from an API — find that API.

**Only acceptable DOM uses:** `isReady()` auth detection (checking for a logged-in indicator), `window.location.href` assignment in `navigate_to_*` tools (fire-and-forget, no data extraction after), and last-resort compose flows (rare).

**The search pattern:** When a site has no search API (search results are client-side rendered from an SSR shell with no embedded data), the correct approach is:
1. **Best:** Find the internal search API the SPA calls (network capture during search interaction)
2. **Good:** Fetch the SSR HTML page via `fetchText`, extract product/item IDs (from `data-*` attributes, inline JSON, or script tags), then batch-enrich via a product details API (the Best Buy pattern — gotcha #42)
3. **Acceptable:** If the page is fully CSR with no extractable IDs in the HTML, use `navigate_to_search` (fire-and-forget navigation) as a separate tool, then have `search_products` read item IDs from the *already-rendered* DOM and enrich via the product API. The navigation and extraction must be separate tool calls — never combine them in one handler
4. **Never:** Navigate + poll + scrape in a single tool handler

**If the first round of API discovery only turns up telemetry, analytics, or HTML endpoints, do not give up.** Dig deeper — every non-trivial web app has internal APIs. Try these escalation techniques before concluding a site has no APIs:

1. **Read JavaScript source bundles** — use `browser_list_resources(tabId, type: "Script")` and `browser_get_resource_content` to read the app's JS bundles. Search for API base URLs, endpoint paths, GraphQL queries, and fetch/XHR call patterns. Minified code still contains string literals like `"/api/v1/"`, `"graphql"`, `"mutation"`, etc.
2. **Intercept XHR/fetch at the network level** — enable network capture, then interact with every feature in the app (click buttons, open modals, filter lists, paginate). Many APIs are only called on user interaction, not on page load.
3. **Search for GraphQL** — look for requests to `/graphql`, `/gql`, or request bodies containing `"query"` or `"operationName"`. Modern apps increasingly use GraphQL even when they serve HTML pages.
4. **Check mobile/API subdomains** — try `api.example.com`, `m.example.com`, `mobile-api.example.com`. Mobile apps often use cleaner APIs than the web UI.
5. **Inspect React/Vue/Angular state stores** — use `browser_execute_script` to access `__REACT_DEVTOOLS_GLOBAL_HOOK__`, Vue devtools, or Angular internals to find how the app fetches and stores data.
6. **Monkey-patch fetch/XHR globally** — install interceptors before navigating, then use every feature to capture all network calls with full request/response bodies.

7. **Extract persisted mutation hashes from JS bundles** — Modern React/Relay apps compile GraphQL operations into persisted queries with hash IDs stored in JS bundles. Search ALL loaded bundles for the pattern `name:"XMutation",operationKind:"mutation"` and extract the `id:"hexhash"` that precedes it. Load different pages (issue creation, PR page, settings) to trigger lazy-loading of feature-specific bundles — each page loads different mutations. Cache discovered mutation name→hash mappings and use them with the site's internal GraphQL endpoint. This is how you unlock ALL write operations on sites that use Relay persisted queries.
8. **Use network capture on UI interactions to reverse-engineer write endpoints** — Enable `browser_enable_network_capture` (with NO url filter to capture everything), then use `browser_click_element` to trigger UI actions (click reaction buttons, submit forms, toggle settings). Check `browser_get_network_requests` to see the exact endpoint, headers, and body format the app uses. This reveals form POST endpoints, GraphQL mutations, and internal RPC calls that are invisible in the static HTML or JS bundles.
9. **Discover same-origin form POST endpoints from the rendered DOM** — Many write operations use traditional HTML form POST with CSRF tokens, even on modern React sites. Enumerate all `<form>` elements on the page: `document.querySelectorAll('form[method="post"]')`. Map their `action` attributes to discover the full write API surface (e.g., `/:owner/:repo/reactions`, `/:owner/:repo/issue_comments`, `/:owner/:repo/pull/:number/review-requests`). Submit these forms via XHR with `FormData` + `X-Requested-With: XMLHttpRequest` to get JSON responses instead of page redirects.

**HARD RULE: The AI must exhaust EVERY discovery technique (all 9 above) before concluding that an endpoint or operation cannot be done.** Do not give up after trying 1-2 approaches. Do not say "this can't be done" after a few failed fetch calls. The correct mindset is: "the web app does this operation in the browser — therefore there IS a way to do it programmatically, and I MUST find it." When the obvious approach fails, escalate: try network capture during UI interaction, search JS bundles, try different headers (`X-Requested-With`, `Accept`, `Turbo-Frame`), try form submission, try GraphQL mutations. Only after genuinely exhausting every technique AND confirming with the user should you report that an operation is not feasible. Being lazy or giving up early is unacceptable — it results in plugins that lack critical functionality the user expects.

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

12. **Probe page bootstrap globals for API endpoint catalogs** — many server-rendered apps embed a resource registry in a page global (e.g., `window.initData.resources`, `window.__CONFIG__.endpoints`). This registry maps human-readable names to REST endpoint URIs with method and type metadata. Inspect the full object via `browser_execute_script` to discover endpoints that are not called during normal page load but are available for plugin use. This is often faster than network capture for mapping the full API surface.

13. **Probe `/rest/` path variants for SSR pages** — when a page is server-rendered HTML (no client-side JSON API visible in network traffic), try inserting `/rest/` into the URL path (e.g., `/purchasehistory/purchases` → `/purchasehistory/rest/purchases`). Some apps serve both HTML and JSON from the same backend, with the REST variant returning structured data. This works on traditional server-rendered e-commerce platforms (ATG Commerce, Hybris, etc.).

14. **Probe Web Worker MessagePort proxy managers** — some SPAs (e.g., Telegram Web) have no HTTP APIs at all. Instead, they run a protocol layer (MTProto, custom binary RPC) inside a Web Worker and expose manager Proxy objects on `window` (e.g., `window.rootScope.managers`) that forward method calls to the worker via `MessagePort`. Method calls like `managers.appUsersManager.getSelf()` return Promises with structured data. Use `browser_execute_script` to enumerate manager keys, then call methods to discover the API surface. The proxy pattern means calling these methods from adapter code works identically to calling them from the app's own UI code — full auth is handled by the worker. Look for page globals with names like `*Manager`, `*Proxy`, `*Port`, or objects with `invokeApi`/`invoke`/`send` methods.

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

### Understand the Audience

Before designing tools, identify who uses this service and what they need. A project management tool serves different workflows than a food ordering app. The tool set must reflect what real users actually do — not just what the API technically supports.

- **Who is the primary user?** A developer managing repos, a marketer tracking campaigns, a customer ordering food, an analyst querying dashboards? Design tools for their daily workflows first.
- **What are the critical paths?** The sequences of actions users perform most often. For a messaging app: read messages → send a reply. For an e-commerce site: browse → add to cart → checkout. For a project tracker: view tasks → update status → add comments. Every critical path must be completable end-to-end using only plugin tools.
- **Prioritize accordingly.** Build the tools that serve the primary user's critical paths first, then expand to advanced/admin operations. A plugin with 10 tools covering all critical paths is better than one with 30 tools that can't complete a single workflow.

### Commerce and Transactional Flows

For services that involve purchases, orders, or payments (e-commerce, food delivery, subscription services, etc.):

- **The plugin must support the entire flow up to (but not including) final payment.** A user should be able to say "order me a large pepperoni pizza" and the plugin must handle the complete sequence: find the item, add to cart, apply any coupons, and navigate to checkout — stopping just before the payment is submitted. The final payment confirmation is a destructive action that requires explicit human approval.
- **Expose a `navigate_to_checkout` tool** (or equivalent) that brings the user to the payment page in their browser, where they can review and confirm. Do not silently submit payment.
- **Only build payment submission tools if the human explicitly asks for it.** Tools like `place_order_cash` or `submit_payment` must not be built by default. If the human requests them, add a clear warning in the tool description that it will charge real money.

### Tool Coverage

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

The API wrapper must use SDK utilities — never reimplement fetch, error classification, cookie parsing, token persistence, or auth polling manually.

```typescript
import {
  ToolError,
  fetchJSON,
  fetchText,
  postJSON,
  putJSON,
  patchJSON,
  deleteJSON,
  buildQueryString,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  getLocalStorage,
  getCookie,
  getPageGlobal,
  getMetaContent,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth token extraction ---
// Use SDK utilities for every source: getLocalStorage, getCookie, getPageGlobal, getMetaContent

interface MyAuth {
  token: string;
  // add other auth fields as needed (accountId, userId, etc.)
}

const getAuth = (): MyAuth | null => {
  // 1. Check persisted cache first (survives adapter re-injection)
  const cached = getAuthCache<MyAuth>('<name>');
  if (cached) return cached;

  // 2. Try localStorage, page globals, cookies — use SDK utilities
  const token = getLocalStorage('auth_token')
    ?? (getPageGlobal('__APP_STATE__.auth.token') as string | undefined)
    ?? getCookie('auth_token');
  if (!token) return null;

  const auth: MyAuth = { token };
  setAuthCache('<name>', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

// Use SDK waitUntil — never use manual setInterval polling
export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

// --- API caller ---
// For simple GET+JSON: use fetchJSON directly in tool handlers
// For custom headers or auth injection: wrap fetchJSON/postJSON with auth logic

const API_BASE = 'https://example.com/api';

export const api = async <T>(endpoint: string, options: {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
} = {}): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  // Use SDK buildQueryString — never manually construct URLSearchParams
  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  // Common headers (auth + CSRF)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  // CSRF token for writes — use SDK getMetaContent
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    const csrf = getMetaContent('csrf-token') ?? getCookie('csrf_token');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  // Use SDK fetch utilities — they handle credentials, timeout, and error classification
  const init: FetchFromPageOptions = { method, headers };

  if (options.body) {
    // For JSON bodies, use postJSON/putJSON/patchJSON directly
    // For custom methods, set body and Content-Type manually
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  // fetchJSON handles: credentials:'include', 30s timeout, HTTP status→ToolError,
  // JSON parsing, and 204 empty responses. You do NOT need to handle any of this.
  const data = await fetchJSON<T>(url, init);
  return data as T;

  // On 401/403 errors, clear the cached auth so it re-reads on next call:
  // clearAuthCache('<name>');
};

// For endpoints that return raw text (diffs, logs, raw file content):
export const apiRaw = async (endpoint: string): Promise<string> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  const url = `${API_BASE}${endpoint}`;
  return fetchText(url, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
};

// For endpoints that accept FormData or non-JSON bodies:
// Use fetchFromPage (NOT raw fetch) + httpStatusToToolError for error classification.
// fetchFromPage handles credentials:'include', timeout, and throws ToolError on HTTP errors.
// Only use this pattern when fetchJSON/postJSON/postFormData don't fit (e.g., mixed body types).
export const apiCustom = async <T>(
  endpoint: string,
  options: { method?: string; body?: FormData | string; contentType?: string },
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in.');

  const url = `${API_BASE}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  // For string bodies, set Content-Type explicitly. For FormData, let the browser set it.
  if (typeof options.body === 'string') {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }

  // fetchFromPage handles: credentials:'include', 30s timeout, and throws
  // httpStatusToToolError on non-ok responses. You do NOT need to handle any of this.
  const response = await fetchFromPage(url, {
    method: options.method ?? 'POST',
    headers,
    body: options.body,
  });

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
```

**Important:** `fetchFromPage` already calls `httpStatusToToolError` internally for all non-ok responses — you do NOT need to check `response.ok` or map status codes manually. If you find yourself writing `if (response.status === 429)` or `if (!response.ok)`, you are bypassing the SDK. Use `fetchFromPage` (or `fetchJSON`/`postJSON` etc.) and let it throw the correct `ToolError` automatically.

**Cross-origin APIs:** Some apps call APIs on a different origin from the page (e.g., a user's personal server, a separate API domain). In these cases, session cookies don't apply — you use a bearer token instead. `fetchFromPage` still works: pass `credentials: 'omit'` to skip cookies, and add an `Authorization` header. All other benefits (timeout, error classification, network error handling) still apply. Never use raw `fetch()` just because the API is cross-origin.

```typescript
// Cross-origin API with bearer token — still use fetchFromPage
const response = await fetchFromPage(url, {
  method: 'GET',
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'omit', // overrides the default 'include'
});
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
  override readonly excludePatterns = []; // optional: exclude URL patterns
  override readonly homepage = 'https://example.com'; // optional: URL to open when no tab exists
  readonly tools: ToolDefinition[] = [sendMessage];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth(); // uses SDK waitUntil internally — see api wrapper above
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

## Phase 6: README

After building the plugin, run `opentabs-plugin readme` to generate the README:

```bash
opentabs-plugin readme
```

This reads `dist/tools.json` and `package.json` to auto-generate the standard README sections: plugin title and description, Install (`opentabs plugin install` + `npm install -g`), Setup (domain from urlPatterns, homepage link), Tools (grouped by `group` field, classified as Read/Write by name prefix, using `summary` field), How It Works, and License.

**Custom sections:** After running the command, append any plugin-specific sections that cannot be auto-generated — ordering flows, authentication quirks, known limitations, or multi-account notes. These sections must be re-added manually each time you regenerate the README.

**Keeping the README in sync:** Whenever tools are added, removed, or modified, re-run `opentabs-plugin readme` to keep the README current. Use `opentabs-plugin readme --dry-run` to preview the output without writing, and `opentabs-plugin readme --check` to verify the README is up to date.

**Rules for custom sections:**
- **No developer content.** No project structure, no code examples, no authentication patterns, no "Adding Tools" section, no shared schemas. Users don't need to know how the plugin is built.
- **No personal information.** No organization names, workspace names, or account details. Use generic examples.

---

## Phase 7: Icon

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

## Phase 8: Build and Test

### Build

```bash
cd plugins/<name>
npm install
npm run build     # tsc + opentabs-plugin build
npm run check     # build + type-check + lint + format:check
```

Every command must exit 0. Use `opentabs-plugin build --watch` for iterative development. Use `opentabs-plugin inspect` to verify the built manifest (tool count, schemas).

**Do NOT run the root-level E2E tests (`npm run test:e2e`) or the full root verification suite (`npm run check`).** Plugin-only changes do not affect the platform — `npm run check` inside the plugin directory is sufficient. The root CLAUDE.md verification checklist applies to platform code changes, not plugin development.

### Enable the Plugin

New plugins start with permission `off`. Before testing, enable it:

1. Verify plugin loaded: `plugin_list_tabs(plugin: "<name>")` — must show `state: "ready"`
2. Ask the user: "I just built this plugin — can I enable it for testing?"
3. On approval, call `plugin_inspect(plugin: "<name>")` to get the review token
4. Call `plugin_mark_reviewed(plugin: "<name>", version: "<version>", reviewToken: "<token>", permission: "auto")` to enable all tools

### Mandatory Tool Verification

**The plugin is not done until every tool has been called against the live browser AND independently verified.**

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

### The Hard Gate: Every Tool Must Work or Be Removed

**A broken tool is worse than a missing tool.** A tool that returns an error, returns empty data, or doesn't match its schema gives false confidence and wastes the user's time. The plugin ships with ONLY tools that have been proven to work end-to-end.

**Before declaring the plugin done, every single tool must pass ALL of these gates:**

1. **Succeeds without errors** — the tool returns data, not an error. If it returns a GraphQL validation error, HTTP 400, schema mismatch, or any other failure, it is broken.
2. **Returns real data** — the returned fields contain actual values from the API, not mapper defaults (`""`, `0`, `[]`, `null` for every field).
3. **Schema validates** — the actual response matches the declared Zod output schema. Test this explicitly: call `tool.output.safeParse(result)` and confirm `success: true`.
4. **Independently verified** — the data is confirmed correct via a browser tool (`browser_screenshot_tab`, `browser_execute_script`, `browser_get_tab_content`), not just by reading the tool's own response.
5. **Round-trip verified** — if you write data, read it back with the corresponding read tool and confirm it matches. If you create an item, list items and confirm the new one appears. If you delete, confirm it's gone.

**A tool that fails any gate must be fixed. Do NOT remove a tool without exhausting every discovery technique (Phase 2 steps 1-9) AND getting explicit confirmation from the user.** When a tool fails, the correct response is to investigate deeper — try alternative endpoints, search JS bundles, capture network traffic during UI interactions, try form submission, try different request headers. Only after genuinely exhausting every approach AND explaining to the user what was tried, ask: "I was unable to make `tool_name` work after trying X, Y, Z. Should I remove it or keep investigating?" Never silently remove tools — broken tools removed without consent represent lost functionality the user expected.

### Test Through the MCP Dispatch Path

**Do NOT only test via `browser_execute_script` calling `adapter.tools.find().handle()`.** That bypasses MCP input/output schema validation, parameter defaulting, and the full dispatch pipeline. A tool that works when called directly through the adapter may fail when called through MCP because:

- The MCP client validates inputs against `input_schema` from `tools.json` — `z.unknown()` produces empty JSON Schema `{}` that rejects all values
- Default values from `z.optional().default(X)` may not apply when the MCP client sends raw parameters
- `additionalProperties: false` rejects parameters that the agent sends but the schema doesn't declare
- Output validation against `output_schema` may reject data that Zod accepts (e.g., `z.unknown()` → empty JSON Schema)

**Test every tool through the actual MCP tool dispatch** — either by calling `<plugin>_<tool_name>` directly (if the tools appear in your tool list after `tools/list_changed`), or via curl to the MCP endpoint. If you cannot call tools through MCP (e.g., tool list not refreshed), at minimum validate the schemas explicitly:

```javascript
// In browser_execute_script: simulate MCP schema validation
const tool = adapter.tools.find(t => t.name === '<name>');
const inputResult = tool.input.safeParse({ /* test params */ });
if (!inputResult.success) return { inputError: inputResult.error.issues };
const result = await tool.handle(inputResult.data);
const outputResult = tool.output.safeParse(result);
if (!outputResult.success) return { outputError: outputResult.error.issues };
return { success: true, data: result };
```

### The Zero-Trust Verification Rule

**NEVER trust a tool's own response as proof that it works.** A tool returning `{ success: true }` or `{ items: [...] }` proves nothing — the data could be stale, the write silently dropped, or the mapper returning default values for every field. **You must independently verify every tool using browser tools** (`browser_screenshot_tab`, `browser_execute_script`, `browser_get_tab_content`).

### How to Verify Each Tool

| Tool type | Call the tool, then... | Red flags |
|---|---|---|
| **Read** (list, get, search) | Cross-check returned data against `browser_screenshot_tab` or `browser_execute_script` reading the same data from the page. Compare field by field: names, counts, IDs, timestamps. | All fields are `""`, `0`, or `[]` (mapper defaults). Tool returns 5 items but UI shows 20. Returns error or empty when the page clearly has data. |
| **Write** (create, update, send) | After the tool returns, **call the corresponding read tool** to confirm the mutation persisted. Then screenshot the UI to double-check. The read-back is mandatory — screenshots alone can miss subtle data issues. | Tool returns `{ success: true }` but the read tool doesn't show the change. |
| **Delete/state-change** (delete, archive, close) | Call the corresponding read/list tool — the resource should be gone or show the new state. Screenshot to confirm. | Resource still exists or state unchanged after "successful" operation. |
| **Error paths** | Call with invalid ID → should return `ToolError.notFound`, not a 500 or empty result. Call without auth → should return `ToolError.auth`. | Generic error or silent empty response instead of classified ToolError. |
| **Tools that depend on other tools** | If tool B needs an ID from tool A's output (e.g., `get_issue` needs an issue ID from `list_issues`), test the full chain: call A → extract the ID → call B with it. If the chain breaks, both tools are suspect. | Tool B returns "not found" when called with IDs from tool A. |

**For every tool, all of these must be true:**
- Called with realistic inputs (not just empty objects or test IDs)
- Result independently verified via a browser tool — NOT just by reading the tool's response
- Returned field values are real data, not mapper defaults
- For write tools: mutation confirmed via separate **read tool call** (not just screenshot)
- For tools with pagination: tested with explicit offset/limit params to confirm pagination works
- For tools with optional filters: tested both with and without filters

**Round-trip verification examples:**
- `create_<resource>` → call `list_<resources>` or `get_<resource>` and confirm the new item appears
- `send_message` → call `read_messages` and confirm the message appears in the list
- `update_<resource>` → call `get_<resource>` and confirm the field changed
- `list_<resources>` → pick an item → call `get_<resource>` with its ID → confirm fields match

**Additional testing:**
- **Workflow tests**: Complete every critical user path end-to-end using only plugin tools (no `browser_*` calls), then `browser_screenshot_tab` to confirm the final state
- **Commerce flows**: Test browse → cart → checkout, stop at `navigate_to_checkout`, and screenshot to verify cart state — do not trust `get_cart` alone. Do not trigger actual payment unless the human explicitly asks.

### When a Tool Fails Verification

**Do not give up easily.** Removing a tool is the last resort after exhausting every legitimate technique:

1. **Debug the root cause** — `browser_execute_script` to inspect raw API response, compare field names against your Raw interface
2. **Try alternative endpoints** — REST, GraphQL, internal RPC, page globals
3. **Web search** — `<service> API <endpoint>` or `<service> developer docs <operation>`
4. **Read JS bundles** — `browser_list_resources` + `browser_get_resource_content` for endpoint paths and request formats
5. **Test variations** — different HTTP methods, Content-Type, auth header formats, request body structures
6. **Study network capture** — `browser_enable_network_capture`, perform the action in the UI, compare what the browser sends vs what your tool sends

Only after multiple genuine attempts across these techniques should you remove the tool. The standard is "I exhausted every reasonable approach" — not "it failed once."

**When you remove a tool, document why.** At the end of the plugin build, list every skipped tool with what you tried and why it failed (e.g., "create_comment — POST /api/comments returns 404; tried GraphQL mutation, also 404; JS bundle search found no alternative endpoint; appears to require a signed request header"). This gives future developers a trail to pick up where you left off.

### Mandatory Self-Review Before Completion

**Do not wait for the user to ask you to review your code.** After all tools are tested and passing, perform a final self-review pass before declaring the plugin done:

1. Re-read every source file — API wrapper, schemas, all tool files, plugin class
2. Delete dead code: unused exports, unused imports, unused types
3. Eliminate duplication: shared fields use `.extend()`, shared mapper logic uses spread composition
4. Verify every export is consumed, every function parameter is used, every return field is read
5. **PII scan** — grep the entire plugin directory for organization names, real user/team/channel IDs, email addresses, workspace URLs, and any other data observed during the test session. Remove anything that is not a generic placeholder. The plugin must read as if it was written without knowledge of any specific organization.
6. **README generation** — run `opentabs-plugin readme` to regenerate the README from `dist/tools.json`. If the plugin has custom sections (ordering flow, limitations, authentication notes), verify they are still present after regeneration — custom content must be re-added manually after the auto-generated content.
7. Run `npm run format` then `npm run check` — all must exit 0
8. Verify the code is clean enough to serve as a reference implementation for other agents to learn from

### Final Verification Gate

**After self-review, run this final checklist. Every line must be true or the plugin is not done.**

1. **Tool count matches** — the number of tools in `dist/tools.json` matches the number of tools in `index.ts`. No phantom tools, no missing tools.
2. **Every tool was tested** — produce a list of all tools with their test status. Format: `tool_name: PASS (tested with X, verified via Y)` or `tool_name: REMOVED (reason)`. Every tool must be accounted for.
3. **No tools return errors** — every tool call succeeded. If a tool returned a GraphQL error, HTTP error, or schema validation error during testing, it was either fixed or removed.
4. **Schema validation confirmed** — for at least the 5 most complex tools, output was validated through `tool.output.safeParse(result)` confirming no schema mismatches (e.g., `z.unknown()` producing empty JSON Schema, nullable fields receiving non-null, arrays receiving objects).
5. **Round-trip chains tested** — at least one write→read chain was verified (e.g., list→get, or create→list to confirm).
6. **No Zod `z.unknown()` in output schemas** — this produces empty JSON Schema `{}` that MCP clients reject. Use concrete types (`z.string()`, `z.array(z.string())`, `z.record(z.string(), z.string())`, etc.).
7. **All optional input parameters have working defaults** — tools work when called with only required parameters (no "variable X of required type Y was not provided" errors).
8. **README is up to date** — `opentabs-plugin readme --check` exits 0. If it fails, run `opentabs-plugin readme` to regenerate.

**When you say "done", the plugin is production-ready. No cleanup pass needed. No review requested. Done means done.**

---

## Phase 9: Write Learnings Back

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
- **SDK-First Rule applies to all code** — see the SDK-First Rule table in Phase 1 for the full MUST/NEVER reference. Never use raw `fetch()`, `localStorage.getItem()`, `document.cookie`, `window` global casts, manual `setInterval` polling, or `URLSearchParams` construction.
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

No dead code, no duplication, no unused imports/exports. Beyond the general standard (see Production Quality Standard), these plugin-specific rules apply:

- **API wrapper exports only what tools need** — do not extract auth fields unless a tool uses them
- **Response types are minimal** — only include fields the tools actually read, not the full API spec
- **Mappers reuse each other** — `mapTagInfo` should spread `mapTag(t)` and add extra fields, not repeat all fields
- **No inline fallback objects** — call the mapper with an empty object (`mapUser(data ?? {})`) instead of a manual default block
- **Consistent return structure** — every list tool returns `{ items, ... }`, every get tool returns the entity directly. Structural consistency makes the plugin predictable

### Schema and Mapper Pattern

Every plugin must co-locate three things in `src/tools/schemas.ts` for each API entity:

1. **Zod output schema** — the clean shape returned to the AI agent
2. **Raw interface** — all fields optional, matching the actual API response shape
3. **Defensive mapper** — converts raw to clean with `?? defaultValue` for every field

```typescript
// src/tools/schemas.ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
});

export interface RawUser {
  id?: string;
  name?: string;
  email?: string;
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? '',
  name: u.name ?? '',
  email: u.email ?? '',
});
```

**Rules:**
- Raw interfaces have ALL fields optional — APIs change, and defensive mapping prevents crashes
- Mappers use `??` not `||` — `??` preserves `0`, `false`, and `''` which are valid values
- Shared schemas go in `schemas.ts` — never duplicate a schema across tool files
- For request bodies with optional fields, use `stripUndefined(params)` from the SDK instead of manual `if (x !== undefined) body.x = x` chains

### Void Operation Pattern

Tools that perform an action with no meaningful return data (delete, archive, close, reopen, etc.) must return `{ success: true }`:

```typescript
output: z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
}),
handle: async (params) => {
  await api(`/items/${params.id}`, { method: 'DELETE' });
  return { success: true };
},
```

Do NOT return empty objects (`{}`), do NOT use `deleted`/`archived`/`closed` — always `success`.

### Tool Naming

| Convention | Example | Note |
|---|---|---|
| Current user's profile | `get_current_user` | Not `get_me` or `get_user_profile` with magic `@me` |
| Send a message | `send_message` with `text` param | Not `content` or `body` |
| Reply to something | `reply_to_tweet_id`, `thread_ts` | Use the platform's native threading concept |
| List resources | `list_<plural>` | e.g., `list_projects`, `list_issues` |
| Get single resource | `get_<singular>` | e.g., `get_project`, `get_issue` |
| Create resource | `create_<singular>` | e.g., `create_project` |
| Update resource | `update_<singular>` | e.g., `update_project` |
| Delete resource | `delete_<singular>` | e.g., `delete_project` |

### Group Naming

Use **plural nouns** for resource groups: `Projects`, `Issues`, `Messages`, `Users`.
Use **singular nouns** for singleton groups: `Account`, `Organization`.

### Icon Conventions

Use Lucide icons consistently:

| Operation | Icon |
|---|---|
| Get current user | `user` |
| List resources | `list` or resource-specific (e.g., `folder` for projects) |
| Get single | Same as list, or `-open` variant |
| Create | `plus` or resource-specific (e.g., `folder-plus`) |
| Update | `pencil` or resource-specific (e.g., `folder-pen`) |
| Delete | `trash-2` or resource-specific (e.g., `folder-x`) |
| Search | `search` |
| Send message | `send` |
| Settings/config | `settings` |

### Pagination Patterns

**Offset pagination** (most common — GitHub, GitLab, Bitbucket, Zendesk):
```typescript
input: z.object({
  page: z.number().int().min(1).optional().describe('Page number (default 1)'),
  per_page: z.number().int().min(1).max(100).optional().describe('Results per page (default 30, max 100)'),
}),
output: z.object({
  items: z.array(itemSchema),
  // no cursor needed — caller increments page
}),
```

**Cursor pagination** (Sentry, Bluesky, Slack):
```typescript
input: z.object({
  cursor: z.string().optional().describe('Pagination cursor from a previous response'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25)'),
}),
output: z.object({
  items: z.array(itemSchema),
  cursor: z.string().describe('Cursor for next page, empty if no more'),
}),
```

### Commerce Plugin Template

For food ordering, e-commerce, or any transactional service, the standard flow is:

| Phase | Tools | Notes |
|---|---|---|
| 1. Find location | `find_stores`, `search_address` | Input: lat/lng or address text |
| 2. Browse menu | `get_menu_categories`, `get_product` | Always requires store ID |
| 3. Manage cart | `create_cart`, `add_product_to_cart`, `update_product_quantity`, `get_cart` | Cart state may be server-side (UUID) or client-side (Redux) |
| 4. Checkout | `get_checkout_summary`, `navigate_to_checkout` | navigate_to_checkout brings the user to the payment page |

**UI sync after mutations:** When the plugin mutates state (add to cart, etc.) through APIs, the SPA's UI may not reflect the change. Three proven strategies:
1. **BroadcastChannel** — post a sync message on the app's own channel
2. **Redux dispatch** — dispatch the app's own action (e.g., `store.dispatch({ type: 'ADD_PRODUCT_TO_CART' })`)
3. **localStorage + reload** — stash state, navigate, apply on load

---

## Auth Patterns

### Auth Detection Sources

Use SDK utilities for every auth source — never reimplement cookie parsing, localStorage access, or global reading.

| Source | SDK Utility | Example |
|---|---|---|
| Non-HttpOnly cookie | `getCookie('token')` | Sentry, Bitbucket, LinkedIn, Reddit |
| localStorage token | `getLocalStorage('auth')` | Discord, Todoist, Bluesky |
| Page global | `getPageGlobal('boot_data.token')` | Slack, Cloudflare, Asana, Airtable |
| Meta tag | `getMetaContent('user-id')` | GitHub, Jira, Confluence, GitLab |
| localStorage scan | `findLocalStorageEntry(key => key.includes('auth'))` | Teams (MSAL), ClickHouse (Auth0) |
| Webpack chunks | Custom extraction from `webpackChunk_*` | X (GraphQL operation hashes) |
| XHR interception | Monkey-patch XMLHttpRequest | ClickUp (WebSocket JWT) |
| Computed hash (SAPISIDHASH) | `getCookie('SAPISID')` + `crypto.subtle.digest` | YouTube (Google services) |
| Token persistence | `getAuthCache<T>(ns)` / `setAuthCache(ns, val)` / `clearAuthCache(ns)` | Survives adapter re-injection |
| Auth polling | `waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 })` | `isReady()` implementation |

### Session Cookies (most common)
Apps using HttpOnly session cookies: SDK's `fetchJSON`/`postJSON` automatically include `credentials: 'include'`. Detect auth via `getPageGlobal('__initialData.isAuthenticated')`, `getCookie('session_indicator')`, or `getMetaContent('user-id')`. Mutating requests often need a CSRF token — check three sources: `getMetaContent('csrf-token')`, `getCookie('csrf_token')`, or `getPageGlobal('initData.csrfToken')`. The CSRF value is typically sent as a header (`X-CSRF-Token`) or a body field (`_csrf`).

### Bearer Tokens
Extract from `getLocalStorage('auth_token')`, `getPageGlobal('__APP_STATE__.auth.token')`, or `getCookie('auth_token')`. **Always persist with `setAuthCache(pluginName, authObj)` to survive adapter re-injection** (module-level variables reset on extension reload). Clear with `clearAuthCache(pluginName)` on 401 to handle rotation.

### Computed Hash Auth (SAPISIDHASH)
Google services (YouTube, etc.) use SAPISIDHASH — a computed authorization header for write operations. The formula is `SAPISIDHASH <timestamp>_<SHA1(timestamp + " " + SAPISID + " " + origin)>` where SAPISID is a non-HttpOnly cookie. Read operations work with cookies alone; writes require this header. Extract the SAPISID cookie with `getCookie('SAPISID')`, compute the hash using `crypto.subtle.digest('SHA-1', ...)`, and send as `Authorization: SAPISIDHASH ...`. The API config (API key, context object, session index) is typically on a page global (e.g., `window.ytcfg.data_`).

### XHR/Fetch Interception
For apps with internal RPC or obfuscated APIs: monkey-patch `XMLHttpRequest.prototype.open/setRequestHeader/send` at adapter load time to capture auth headers. Store on `globalThis`. Re-patch on each adapter load (avoid stale `if (installed) return` guards).

### First-Party API Headers
Some apps (e.g., Asana) use HttpOnly cookie auth where GET requests work automatically with `credentials: 'include'` but POST/PUT/DELETE requests return 401 unless a specific first-party header is present. Look in CORS `Access-Control-Allow-Headers` for custom headers like `X-Allow-Asana-Client`, `X-Requested-With`, or similar. These are not CSRF tokens — they are gate headers that distinguish first-party app requests from third-party API calls. The header value is typically a static string (`'1'`). Check the CORS response headers during Phase 2 network analysis.

### Google API Client Proxy (`gapi.client`)
Google services (Analytics, Tag Manager, Search Console, etc.) route API calls through `gapi.client.request()` which uses a proxy iframe on `clients6.google.com`. Direct `fetch()` calls to `*.googleapis.com` from the app's origin fail with CORS errors or "invalid argument" (SAPISIDHASH rejected). The correct transport is `getPageGlobal('gapi').client.request({ path, method, params, body, headers })` which returns a thenable with `.then(onOk, onErr)`. The API key is typically on a page global (e.g., `window.preload.globals.gmsSuiteApiKey` or `window.suiteBindings.apiKey`). Auth (SAPISIDHASH + `X-Goog-AuthUser`) is handled automatically by the gapi proxy — you only need to pass the API key as a `params.key` query parameter. **Critical:** The gapi rejection handler receives an error object with `{ status, result: { error: { code, message } } }` — always use `reject()` not `throw` inside the `.then()` error callback, as throwing inside a thenable callback causes unhandled rejections that make the outer promise hang indefinitely.

### Internal Module System Auth (Facebook `require()`)
Apps with custom module systems (e.g., Facebook's `__d`/`require`) expose auth tokens and CSRF values as module exports. Facebook stores `fb_dtsg` (CSRF) in `require('DTSGInitialData').token`, `lsd` in `require('LSD').token`, and user data in `require('CurrentUserInitialData')`. Access via a safe wrapper: `const fbRequire = (name) => { try { return globalThis.require(name); } catch { return undefined; } }`. These modules are synchronously available at adapter injection time.

### Opaque Auth Headers
Some apps compute cryptographic tokens via obfuscated JS — capture and replay, don't generate. Poll with timeout for the header to appear.

---

## Gotchas

1. All plugin code runs in the browser — no Node.js APIs
2. SPAs hydrate asynchronously — `isReady()` must poll using `waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 })` — never use manual `setInterval`
3. Some apps delete `window.localStorage` — use SDK `getLocalStorage(key)` which has an automatic iframe fallback. Never use `localStorage.getItem()` directly.
4. Module-level variables reset on extension reload — persist tokens using SDK `setAuthCache(pluginName, authObj)` / `getAuthCache<T>(pluginName)` — never access `globalThis.__openTabs.tokenCache` manually
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
25. SPAs exposing their Redux store as a **page global** (e.g., `window.store`) enable direct state reads and action dispatches from the adapter. For **reads**, use `getPageGlobal('store').getState()` to access any slice without API calls — this is faster and works offline. For **writes** (e.g., adding items to a cart), dispatch Redux actions directly: `store.dispatch({ type: 'ADD_PRODUCT_TO_CART', payload })`. To discover action type strings, search the app's JS bundles for known operation names using `indexOf` — minified bundles still contain the string constants (e.g., `C="ADD_PRODUCT_TO_CART"`, `y="CHANGE_QUANTITY"`). The cart item payload structure can be reverse-engineered by: (a) adding an item via the UI, (b) reading `store.getState().ordering.cart.current` to see the shape, and (c) replicating that shape in the tool's dispatch payload. This pattern is preferable to the persist-root stash-and-reload pattern (#23/#24) when the Redux store global is available
26. SPA client-side flags (e.g., `sessionExpired`, `isStale`) in the Redux store may not reflect actual HTTP session validity. These flags get set during client-side session refresh flows or navigation events, even when the user's cookies and API access are still valid. For `isReady()` auth detection, prefer checking for the presence of loaded user data (e.g., `accountProfile.data` being non-null) over trusting boolean flags that the SPA's session management may toggle independently
27. Some apps use **BFF orchestration layers** that expose a single POST endpoint per operation (e.g., `/apiproxy/v1/orchestra/<operationId>`) with a body like `{ operationId, variables }`. These combine multiple backend calls into one response. To discover all available operations, search JS bundles for the operation ID constant module — it typically exports a plain object mapping constant names to string IDs (e.g., `{PRICE_ORDER:"price-order", PLACE_ORDER:"submit-order", GET_FAVORITE_PRODUCTS:"get-favorite-products"}`). Create an `orchestraApi(operationId, variables)` helper in the API wrapper alongside the standard REST `api()` helper
28. Some apps use **gRPC-Web** with protobuf encoding instead of REST/GraphQL. The SPA loads a protobuf library (typically `google-protobuf`) and exposes compiled message classes on a page global (e.g., `window.proto`). Each class has `serializeBinary()`, `deserializeBinary(bytes)`, and `toObject()` methods, plus dynamic setters (`setClusterId`, `setName`). The gRPC-Web transport POSTs to `/<package.Service>/<Method>` with `Content-Type: application/grpc-web+proto` and a 5-byte frame header (flag:1 + big-endian-length:4 + payload:N). Response frames use flag=0 for data and flag=128 for trailers (containing `grpc-status` and `grpc-message`). Map gRPC status codes to ToolError: 3→validation, 5→notFound, 7→auth, 8→rateLimited, 16→auth. Since the message classes are generated code with dynamic setters, create a `setField(msg, setter, value)` helper to avoid lint warnings from `as any` casts. Request classes may live across multiple proto namespaces — search all of them when constructing requests
29. **Non-standard rate limit headers**: Not all APIs use `Retry-After`. Use `parseRateLimitHeader(headers)` from the SDK which checks: `Retry-After` (standard), `x-rate-limit-reset` (X/Twitter — epoch seconds), `x-ratelimit-reset` (Reddit — seconds until reset), `RateLimit-Reset` (IETF draft — seconds). Always handle rate limits in the API wrapper rather than individual tool handlers
30. **Webpack chunk probe IDs are cached by the runtime.** When using `webpackChunkof_vue.push([[chunkId], {}, (require) => { ... }])` to access the webpack `require` function, the runtime tracks installed chunk IDs internally. Pushing a probe entry with the same chunk ID string on subsequent calls causes webpack to recognize it as already installed and skip the callback — `require` is never captured. Use a monotonically incrementing counter (`let probeCounter = 0; ... [`__ot_${++probeCounter}`]`) to guarantee unique IDs on every call. Additionally, **cache the result** — the webpack `require` function and the modules it returns never change during a page session. Call the probe once, cache the `require` function or the specific module export (e.g., the header builder function), and reuse it for all subsequent API calls. This eliminates both the ID collision risk and the overhead of repeated chunk probes
31. **Service Workers intercept page fetch but NOT adapter fetch.** Some SPAs (e.g., Stripe Dashboard) use a Service Worker that intercepts `/api/` or `/v1/` requests and injects authorization headers (Bearer tokens) before forwarding them. Adapter code injected via `chrome.scripting.executeScript` runs in the page context where the SW is registered, but the SW may not intercept adapter-originated `fetch()` calls (the behavior depends on the SW's claim/scope strategy and timing). If `/v1/` requests from the adapter return 401 while the same URLs work when the page itself calls them, the SW is likely injecting auth. Solution: extract the token from page globals (e.g., `PRELOADED.session_api_key`, `window.__config.apiToken`) and add the `Authorization` header explicitly. Also, `fetchFromPage`'s `AbortSignal.timeout()` may conflict with SW request lifecycle — use raw `fetch()` with manual error handling and `httpStatusToToolError` when the SW is involved
32. **Form-encoded request bodies.** Some APIs (e.g., Stripe) use `application/x-www-form-urlencoded` instead of JSON for POST/PUT bodies, with bracket notation for nested objects (`metadata[key]=value`) and array syntax (`items[]=a&items[]=b`). The SDK's `postJSON`/`putJSON` send JSON bodies and cannot be used. Write a custom `encodeBody(obj, prefix?)` recursive helper that handles nested objects and arrays, and set `Content-Type: application/x-www-form-urlencoded` on the request
33. **Multi-subdomain APIs sharing a single bearer token.** Some apps (e.g., Robinhood) split their API across multiple subdomains (`api.example.com`, `bonfire.example.com`, `nummus.example.com`) where each subdomain serves a different data domain (accounts, portfolio performance, crypto) but all accept the same bearer token. Create separate API helper functions for each subdomain (`api()`, `bonfireApi()`, `nummusApi()`) that share a common `doFetch()` implementation with the base URL parameterized. During Phase 2, catalog which endpoints live on which subdomain — `plugin_analyze_site` captures all of them. Account-scoped endpoints often embed an account number in the URL path — lazily fetch and cache this via a helper (e.g., `getAccountNumber()`) rather than requiring it as a tool input
34. **Silent write acceptance — APIs returning 200 but discarding mutations.** Some endpoints accept PATCH/POST with a 200 response but silently ignore certain fields in the request body. This is different from a 404 or 405 — the endpoint is real and actively used for other fields (e.g., renaming a list works, but the same PATCH ignoring an `items` or `children` field). During Phase 7 testing, always verify write tools with a round-trip: create → read back → confirm the change persisted. If a write appears to succeed (200) but the data doesn't change, the endpoint does not support that mutation via the API. Remove the tool rather than shipping a silently broken one
35. **Zod `.default()` makes fields required in JSON Schema.** Using `z.string().default('value')` on input schema fields causes the field to appear as **required** in the generated JSON Schema — MCP clients reject calls that omit the field, even though Zod would apply the default. Use `.optional()` instead and apply the default in the handler: `const market = params.market ?? 'XNYS'`. This applies to all input schema fields where you want a default value but the caller should not be forced to provide it
36. **Cross-origin API CORS support varies per service endpoint.** When a web app makes API calls to multiple cross-origin service endpoints (e.g., AWS Console calling `ec2.us-east-2.amazonaws.com`, `iam.amazonaws.com`, `s3.us-east-2.amazonaws.com`), each endpoint may have its own CORS policy. Some allow `Access-Control-Allow-Origin: *`, others only allow specific origins, and some block cross-origin entirely. During Phase 2, test CORS for every service endpoint you plan to use — not just one representative endpoint. A `fetch()` that throws "Failed to fetch" (TypeError, not an HTTP status) is the signature of a CORS block. When an endpoint is CORS-blocked, do not clear the auth cache on failure — the credentials are valid, only the endpoint is unreachable. Build tools only for endpoints that pass CORS preflight from the page origin
37. **Same-origin iframe credential interception via Response.prototype.json.** Apps with micro-frontend architectures (e.g., AWS Console, Azure Portal) load service modules in same-origin iframes that independently obtain credentials via HTTP token exchange. The adapter cannot intercept the initial exchange (it runs at `document_idle`, after iframe scripts), but can capture subsequent exchanges by patching `Response.prototype.json` in each iframe's window context. Use a `MutationObserver` on `document.body` to detect new iframes and patch them on their `load` event. The interceptor checks for credential-shaped objects in every JSON response and persists them via SDK `setAuthCache`. Guard the installation with `typeof document !== 'undefined'` for Node.js build compatibility
38. **CSP `connect-src` blocks cross-origin API calls from the page context.** Adapter file-based injection bypasses `script-src` CSP, but `connect-src 'self'` (or `default-src 'self'` with no `connect-src` override) blocks all cross-origin `fetch`/`XHR` from adapter code. During Phase 2, check for CSP headers: `browser_execute_script` → `fetch('/any-page').then(r => r.headers.get('content-security-policy'))`. If `connect-src` or `default-src` restricts origins, cross-origin APIs (even with valid CORS) are unreachable. The workaround is to use same-origin server-rendered pages: fetch HTML via `fetchText('/path')`, parse with `new DOMParser().parseFromString(html, 'text/html')`, and extract data from the DOM tree. This works because same-origin requests are always allowed by CSP. The approach is viable for sites with stable, simple HTML (e.g., Hacker News) but fragile for SPAs with complex or frequently changing markup
39. **GraphQL BFF servers rejecting standard `$variable` type declarations.** Some enterprise GraphQL BFF (Backend-for-Frontend) servers do not expose their input type names or use non-standard type names internally. Queries with proper `$variable: TypeName!` declarations return HTTP 400 with opaque errors (e.g., `{"errors":[null]}`), while the same query with inline arguments (values embedded directly in the query string) succeeds. During Phase 2, test every GraphQL query both ways: first with parameterized variables (`query Foo($bar: BarInput!) { ... }` + `variables: { bar: {...} }`), then with inline arguments (`query Foo { foo(bar: {field: "value"}) { ... } }` + empty variables). If parameterized queries fail but inline queries succeed, the server's type system is opaque — use inline arguments throughout. Note that inline arguments require careful string escaping for user-provided values to prevent query injection. Prefer this pattern only for values you control (account numbers, enum strings) and sanitize any free-text input
40. **Bot protection systems (PerimeterX, HUMAN, DataDome) may protect some endpoints but not others.** Sites using bot protection middleware (e.g., `x-px-blocked: 1` header) may block most API endpoints from adapter-originated fetch calls while leaving certain internal routes unprotected. The protected vs unprotected distinction typically follows CDN routing — pages behind CloudFront with PX origin-verify are protected, while serverless function routes or static-origin routes bypass the protection layer. During Phase 2, test every endpoint you plan to use individually: if a simple fetch returns HTML with a captcha or 403 with `x-px-blocked: 1`, that endpoint is bot-protected. Keep testing other endpoints — the app likely has internal APIs on different routing paths that do not trigger bot detection
41. **Relay persisted queries with deployment-specific `doc_id` via internal module system.** Facebook and similar React/Relay apps use persisted GraphQL queries where each operation is identified by a numeric `doc_id` that changes on every client-side deployment. Unlike Apollo persisted queries (gotcha #22 which use sha256 hashes), these `doc_id` values are accessible at runtime via the app's internal module system: `require('<OperationName>_facebookRelayOperation')` returns the doc_id as a string. Not all modules are loaded on every route — cache resolved doc_ids on `globalThis` so they survive SPA route transitions. Additionally, scan SSR `<script>` tags for `{ queryID: "...", queryName: "..." }` patterns to find doc_ids for queries that are only loaded via server-side preloaders (e.g., search bootstrap). When both data and errors are present in the GraphQL response, only throw on errors if no `data` field exists — Facebook returns non-critical `missing_required_variable_value` errors alongside valid data when optional variables are omitted
42. **SSR search pages with batch product enrichment.** Some e-commerce sites serve search results as server-rendered HTML with no JSON search API. The search page HTML contains embedded SKU/product IDs (in `data-sku-id` attributes, inline JSON, or script tags) but not full product details. The workaround: fetch the search page via `fetchText('/search?q=QUERY')`, extract product IDs with regex (`/data-sku-id="(\d+)"/g` or `/"skuId"\s*:\s*"(\d+)"/g`), then batch-fetch full product details from a separate product details API (e.g., `/api/3.0/priceBlocks?skus=ID1,ID2,...`). Filter out empty results — some IDs may be sponsored placements or ads that the product API doesn't recognize. This two-step pattern (HTML parse for IDs → batch API enrichment) is the correct approach when search has no JSON endpoint but product details do
43. **Next.js SSR data extraction via `__NEXT_DATA__` as primary data access.** When a Next.js app's API endpoints (GraphQL, REST) are fully protected by bot detection (Akamai, PerimeterX) and return 418/403 for all adapter-originated `fetch()` calls, the same-origin HTML pages still work because they go through the standard CDN/SSR pipeline. Fetch pages via `fetchFromPage(url, { headers: { accept: 'text/html' } })`, extract the `<script id="__NEXT_DATA__" ...>` tag with a regex (`/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/`), and parse the JSON. The `__NEXT_DATA__.props.pageProps` object contains all SSR-injected data: search results, product details, user profiles, order history, etc. This pattern works reliably because: (a) same-origin HTML requests always pass bot detection, (b) Next.js embeds the full `getServerSideProps` return value in the page, and (c) the JSON structure is stable across deployments (tied to the page route, not client JS bundles). The tradeoff is latency — each tool call fetches a full HTML page (~1-2MB) instead of a lightweight JSON API response. For write operations (add to cart, place order), this approach does not work since mutations require API calls. If the API is fully protected, expose `navigate_to_*` tools that set `window.location.href` and let the user complete actions in the browser
44. **Tiered request signing with partial page-global signing and SSR fallback.** Some apps (e.g., TikTok) use a multi-layer request signing system where: (a) a page-global signing function (e.g., `window.byted_acrawler.frontierSign(url)`) generates a basic signature parameter (`X-Bogus`) that works for **some** endpoints (search, recommendations, user lists) but not others, and (b) a WebAssembly-based "ticket guard" generates an additional signature required for **other** endpoints (user detail, comments, write operations). Blocked endpoints return HTTP 200 with a **0-byte response body** — not 401/403/404, making the failure appear as if the endpoint simply returned no data. During Phase 2, test every endpoint individually and classify into three tiers: (1) works with page-global signing only, (2) requires full ticket guard (blocked), (3) data available via SSR page fetch. Build tools using tier-1 (signed API) for endpoints that work, SSR page fetch for tier-2 blocked read endpoints (fetching the HTML page and extracting `__UNIVERSAL_DATA_FOR_REHYDRATION__` or similar SSR data), and remove tier-2 write endpoints that cannot be accessed through either path. The page-global signing function may only return a subset of required parameters — always verify by comparing your signed requests against the browser's natural requests in the network capture
45. **CSRF tokens from SSR initial state expire after page load.** Some SPAs (e.g., Tumblr's Redpop) embed a CSRF token in the SSR'd initial state (e.g., `<script type="application/json" id="___INITIAL_STATE___">` containing `csrfToken`), but this token expires shortly after the page loads. The SPA refreshes it by reading the `x-csrf` response header from each API call. Write operations using the stale initial token fail with 401 (not 403 — the error looks like an auth failure, not a CSRF rejection). The fix: before every write operation, make a lightweight GET request (e.g., `/api/v2/user/info`) to obtain a fresh CSRF from the response `x-csrf` header, and also update the cached CSRF from every API response. During Phase 2, test write operations immediately after page load AND after a delay — if writes work immediately but fail minutes later, the CSRF token is rotating

46. **`X-Requested-With: XMLHttpRequest` triggers full server-side rendering.** Some SPAs (e.g., GitHub) return a lightweight shell page (~39KB) for normal requests, with React components loading data asynchronously. Adding `X-Requested-With: XMLHttpRequest` to the request headers causes the server to return the **full pre-rendered page** (~1MB+) with all embedded React/Relay data in `<script data-target="react-app.embeddedData">` tags. This is essential for extracting structured data from pages that would otherwise require waiting for React hydration. Always test fetches with and without this header during Phase 2 — the difference in response content can be dramatic.
47. **XHR form submission with `FormData` for authenticated writes.** Sites that use traditional HTML forms for write operations (comments, reactions, settings) often reject `fetch()` POST requests even with correct CSRF tokens. The solution: submit via `XMLHttpRequest` with `FormData` (not `URLSearchParams`) and set both `Accept: application/json` and `X-Requested-With: XMLHttpRequest` headers. GitHub's form handlers check for `X-Requested-With` to distinguish AJAX submissions (return JSON) from browser form submissions (return redirect). Build a `submitPageForm(pagePath, formSelector, fields)` helper that: (1) fetches the page HTML with `X-Requested-With: XMLHttpRequest`, (2) parses the HTML with `DOMParser` to find the form and extract all hidden inputs (CSRF token, timestamps, honeypot fields), (3) builds `FormData` with the form's original values plus overrides, (4) submits via `XMLHttpRequest`. This pattern works for any operation that has a traditional `<form>` on the page.
48. **CORS `Access-Control-Allow-Origin: *` blocks authenticated requests.** When a site's API returns `Access-Control-Allow-Origin: *` (wildcard), the browser refuses to send cookies with `credentials: 'include'` — this is a CORS spec requirement, not a bug. The API calls succeed but are **unauthenticated**, meaning they can only access public data. This is a fatal flaw for plugins targeting private/enterprise content. During Phase 2, verify immediately: `fetch('https://api.example.com/user', { credentials: 'include' })` — if it throws a TypeError ("Failed to fetch"), the API uses wildcard CORS and cannot be used for authenticated access. Switch to same-origin endpoints exclusively: page JSON (`Accept: application/json`), embedded React/Relay data, internal GraphQL (`/_graphql`), and form POST endpoints.
49. **Relay persisted mutation hashes in lazy-loaded JS bundles.** Write operations (create, update, delete, merge) often use Relay persisted GraphQL mutations whose hash IDs are stored in feature-specific JS bundles. These bundles are only loaded when the user navigates to the relevant page (e.g., the issue creation page loads the `createIssueMutation` bundle). To discover all available mutations: (1) fetch multiple page URLs (issues/new, PR page, releases/new, settings) with `X-Requested-With: XMLHttpRequest` to get the full HTML, (2) extract all `<script src="...">` bundle URLs, (3) fetch each bundle and search for the pattern `name:"XMutation",operationKind:"mutation"` with the preceding `id:"hexhash"`. Cache the name→hash mapping at adapter initialization time. On deployment changes, the hashes change — detect `unknownQuery` errors and re-discover. This approach unlocked 68 mutations on GitHub including `createIssueMutation`, `addReactionMutation`, `createRepositoryLabelMutation`, and many more.

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

Resolution order: per-tool override → plugin default → `off`.
