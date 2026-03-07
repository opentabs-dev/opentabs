/** Prompt text for the `build_plugin` prompt — full plugin development workflow. */

export const buildPluginPromptText = (url: string, name: string): string => {
  const nameClause = name ? `The plugin name should be \`${name}\`.` : '';

  return `Build a production-ready OpenTabs plugin for ${url}. ${nameClause}

Follow the complete workflow below. Each phase builds on the previous one — do not skip phases.

---

## Prerequisites

- The user has the target web app open in a browser tab at ${url}
- The MCP server is running (you are connected to it)
- You have access to the filesystem for creating plugin source files

### Browser Tool Permissions

Plugin development requires heavy use of browser tools (\`browser_execute_script\`, \`browser_navigate_tab\`, \`browser_get_tab_content\`, etc.). By default, tools have permission \`'off'\` (disabled) or \`'ask'\` (requires human approval).

Ask the user if they want to enable \`skipPermissions\` to bypass approval prompts during development. Set the env var: \`OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS=1\`. Warn them this bypasses human approval and should only be used during active plugin development.

---

## Core Principle: Use the Real APIs, Never the DOM

Every plugin tool must use the web app's own APIs — the same HTTP endpoints, WebSocket channels, or internal RPC methods that the web app's JavaScript calls. DOM scraping is never acceptable as a tool implementation strategy. It is fragile (breaks on any UI change), limited (cannot access data not rendered on screen), and slow (parsing HTML is orders of magnitude slower than a JSON API call).

When an API is hard to discover, spend time reverse-engineering it (network capture, XHR interception, source code reading). Do not fall back to DOM scraping because it is faster to implement.

**Only three uses of the DOM are acceptable:**
1. \`isReady()\` — checking authentication signals (meta tags, page globals, indicator cookies)
2. URL hash navigation — triggering client-side route changes
3. Last-resort compose flows — when the app has no API for creating content and the UI is the only path (rare)

---

## Phase 1: Research the Codebase

Before writing any code, study the existing plugin infrastructure using the filesystem:

1. **Study the Plugin SDK** — read \`platform/plugin-sdk/CLAUDE.md\` and key source files (\`src/index.ts\`, \`src/plugin.ts\`, \`src/tool.ts\`). Understand:
   - \`OpenTabsPlugin\` abstract base class (name, displayName, description, urlPatterns, tools, isReady)
   - \`defineTool({ name, displayName, description, icon, input, output, handle })\` factory
   - \`ToolError\` static factories: \`.auth()\`, \`.notFound()\`, \`.rateLimited()\`, \`.timeout()\`, \`.validation()\`, \`.internal()\`
   - SDK utilities: \`fetchJSON\`, \`postJSON\`, \`getLocalStorage\`, \`waitForSelector\`, \`retry\`, \`sleep\`, \`log\`
   - All plugin code runs in the **browser page context** (not server-side)

2. **Study an existing plugin** (e.g., \`plugins/slack/\`) as the canonical reference:
   - \`src/index.ts\` — plugin class, imports all tools
   - \`src/slack-api.ts\` — API wrapper with auth extraction + error classification
   - \`src/tools/\` — one file per tool, shared schemas
   - \`package.json\` — the opentabs field, dependency versions, scripts

3. **Study \`plugins/CLAUDE.md\`** — plugin isolation rules and conventions

---

## Phase 2: Explore the Target Web App

This is the most critical phase. Use browser tools to understand how the web app works.

### Step 1: Find the Tab

\`\`\`
plugin_list_tabs  or  browser_list_tabs  →  find the tab for ${url}
\`\`\`

### Step 2: Analyze the Site

\`\`\`
plugin_analyze_site(url: "${url}")
\`\`\`

This gives you a comprehensive report: auth methods, API endpoints, framework detection, storage keys, and concrete tool suggestions.

### Step 3: Enable Network Capture and Explore

\`\`\`
browser_enable_network_capture(tabId, urlFilter: "/api")
\`\`\`

Navigate around in the app to trigger API calls, then read them:

\`\`\`
browser_get_network_requests(tabId)
\`\`\`

Study the captured traffic to understand:
- API base URL
- Whether the API is same-origin or cross-origin (critical for CORS)
- Request format (JSON body vs form-encoded)
- Required headers (content-type, custom headers)
- Response shapes for each endpoint
- Error response format

### Step 4: Check CORS Policy (for Cross-Origin APIs)

If the API is on a different subdomain, verify CORS behavior:

\`\`\`bash
curl -sI -X OPTIONS https://api.example.com/endpoint \\
  -H "Origin: ${url}" \\
  -H "Access-Control-Request-Method: GET" \\
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \\
  | grep -i "access-control"
\`\`\`

### Step 5: Discover Auth Token

**First, always check cookies with \`browser_get_cookies\`** to understand the auth model. Then probe the page:

- **localStorage**: Direct access or iframe fallback if the app deletes \`window.localStorage\`
- **Page globals**: \`window.__APP_STATE__\`, \`window.boot_data\`, \`window.__NEXT_DATA__\`
- **Webpack module stores**: For React/webpack SPAs
- **Cookies**: \`document.cookie\` for non-HttpOnly tokens
- **Script tags**: Inline \`<script>\` tags with embedded config

### Step 6: Test the API

Once you have the token, make a test API call with \`browser_execute_script\`:

\`\`\`javascript
const resp = await fetch('https://example.com/api/v2/me', {
  headers: { Authorization: 'Bearer ' + token },
  credentials: 'include',
});
const data = await resp.json();
return data;
\`\`\`

### Step 7: Intercept Internal API Traffic (for apps without clean REST APIs)

Some web apps do not expose clean REST or GraphQL APIs. Instead they use internal RPC endpoints, obfuscated paths, or proprietary protocols that are hard to discover via network capture alone. For these apps, monkey-patch \`XMLHttpRequest\` and \`fetch\` to intercept all API traffic and capture auth headers at runtime.

Install the interceptor at adapter load time to capture auth tokens from early boot requests. Store captured data on \`globalThis\` so it survives adapter re-injection.

\`\`\`javascript
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
\`\`\`

Use this when:
- The app uses internal RPC endpoints not visible in standard network capture
- Auth tokens are computed by obfuscated JavaScript and cannot be extracted from storage
- You need to discover which headers the app sends on its own API calls

### Step 8: Map the API Surface

Discover the key endpoints: user/profile, list resources, get single resource, create/update/delete, search, messaging, reactions.

---

## Phase 3: Scaffold the Plugin

\`\`\`bash
cd plugins/
opentabs plugin create <name> --domain <domain> --display <DisplayName> --description "OpenTabs plugin for <DisplayName>"
\`\`\`

After scaffolding, compare \`package.json\` with an existing plugin (e.g., \`plugins/slack/package.json\`) and align:
- Package name: \`@opentabs-dev/opentabs-plugin-<name>\` for official plugins
- Version: Match the current platform version
- Add: \`publishConfig\`, \`check\` script
- Dependency versions: Match \`@opentabs-dev/plugin-sdk\` and \`@opentabs-dev/plugin-tools\` versions

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

\`\`\`
src/
  index.ts              # Plugin class — imports all tools, implements isReady()
  <name>-api.ts         # API wrapper — auth extraction + error classification
  tools/
    schemas.ts          # Shared Zod schemas + defensive mappers
    send-message.ts     # One file per tool
    ...
\`\`\`

### API Wrapper Pattern (\`<name>-api.ts\`)

The API wrapper handles auth extraction, request construction, and error classification:

\`\`\`typescript
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

  let url = \\\`https://example.com/api\\\${endpoint}\\\`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += \\\`?\\\${qs}\\\`;
  }

  const headers: Record<string, string> = { Authorization: \\\`Bearer \\\${auth.token}\\\` };
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
      throw ToolError.timeout(\\\`API request timed out: \\\${endpoint}\\\`);
    throw new ToolError(
      \\\`Network error: \\\${err instanceof Error ? err.message : String(err)}\\\`,
      'network_error', { category: 'internal', retryable: true },
    );
  }

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) throw ToolError.rateLimited(\\\`Rate limited: \\\${endpoint}\\\`);
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(\\\`Auth error (\\\${response.status}): \\\${errorBody}\\\`);
    if (response.status === 404) throw ToolError.notFound(\\\`Not found: \\\${endpoint}\\\`);
    throw ToolError.internal(\\\`API error (\\\${response.status}): \\\${endpoint} — \\\${errorBody}\\\`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
\`\`\`

### Tool Pattern (one file per tool)

\`\`\`typescript
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
\`\`\`

### Plugin Class Pattern (\`index.ts\`)

\`\`\`typescript
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
\`\`\`

---

## Phase 6: Build and Test

### Build

\`\`\`bash
cd plugins/<name>
npm install
npm run build
\`\`\`

### Full Check Suite

\`\`\`bash
npm run check  # build + type-check + lint + format:check
\`\`\`

**Every command must exit 0.** Fix any failures before proceeding.

### Mandatory Tool Verification

**The plugin is not done until every tool has been called against the live browser.** Tools that have not been verified may have wrong field mappings, broken endpoints, or incorrect response parsing.

1. **Verify plugin loaded**: \`plugin_list_tabs(plugin: "<name>")\` — must show \`state: "ready"\`
2. **Call every read-only tool** (list, get, search) — verify response contains real data with correct field mappings
3. **Call every write tool** with round-trip tests (create → verify → delete → verify)
4. **Test error classification** — call a tool with an invalid ID, verify \`ToolError.notFound\` is returned
5. **Fix every failure** — use \`browser_execute_script\` to inspect raw API responses and fix mappers

**A plugin with untested tools is worse than a plugin with fewer tools.** Remove tools you cannot verify rather than shipping them broken.

---

## Key Conventions

- **One file per tool** in \`src/tools/\`
- **Every Zod field gets \`.describe()\`** — this is what AI agents see in the tool schema
- **\`description\` is for AI clients** — detailed, informative. \`summary\` is for humans — short, under 80 chars
- **Defensive mapping** with fallback defaults (\`data.field ?? ''\`) — never trust API shapes
- **Error classification is critical** — use \`ToolError\` factories, never throw raw errors
- **\`credentials: 'include'\`** on all fetch calls
- **30-second timeout** via \`AbortSignal.timeout(30_000)\`
- **\`.js\` extension** on all imports (ESM requirement)
- **No \`.transform()\`/\`.pipe()\`/\`.preprocess()\`** in Zod schemas (breaks JSON Schema serialization)

---

## Common Gotchas

1. **All plugin code runs in the browser** — no Node.js APIs
2. **SPAs hydrate asynchronously** — \`isReady()\` must poll (500ms interval, 5s max)
3. **Some apps delete browser APIs** — use iframe fallback for \`localStorage\`
4. **Tokens must persist on \`globalThis.__openTabs.tokenCache.<pluginName>\`** — module-level variables reset on extension reload
5. **HttpOnly cookies are invisible to plugin code** — use \`credentials: 'include'\` for the browser to send them automatically, detect auth status from DOM signals
6. **Parse error response bodies before classifying by HTTP status** — many apps reuse 403 for both auth and permission errors
7. **Cross-origin API + cookies: check CORS before choosing fetch strategy**
8. **Always run \`npm run format\` after writing code** — Biome config uses single quotes
9. **Adapter injection timing** — adapters are injected at \`loading\` (before page JS runs) and \`complete\` (after full load). \`isReady()\` is called at both points. Cache tokens from localStorage at loading time before the host app deletes them.
10. **Token persistence on \`globalThis\` survives re-injection** — use \`globalThis.__openTabs.tokenCache.<pluginName>\` to persist auth tokens. Module-level variables reset when the extension reloads. Clear the persisted token on 401 responses to handle token rotation.
11. **Error classification: parse body before HTTP status** — many apps return JSON error codes in the response body that distinguish auth errors from permission errors. Parse the body first, then fall back to HTTP status classification.
12. **Cookie-based auth may require CSRF tokens for writes** — apps using HttpOnly session cookies often require a CSRF token header for non-GET requests. The CSRF token is typically in a non-HttpOnly cookie. Check \`window.__initialData.csrfCookieName\` or similar bootstrap globals to discover the cookie name.
13. **Check bootstrap globals for auth signals** — \`window.__initialData\`, \`window.__INITIAL_STATE__\`, \`window.boot_data\` are more reliable than DOM for auth detection. Inspect these early during exploration.
14. **Some apps use internal APIs instead of public REST** — the public API may require OAuth2, but the web client uses internal same-origin endpoints with cookie auth. Look for internal endpoints when public API rejects auth.
15. **Intercepted headers must survive adapter re-injection** — store captured tokens on \`globalThis.__<pluginName>CapturedTokens\`. Re-patch XHR on each adapter load. Avoid stale \`if (installed) return\` guards that skip re-patching after re-injection.
16. **Trusted Types CSP blocks \`innerHTML\`** — use regex \`html.replace(/<[^>]+>/g, '')\` for HTML-to-text conversion instead. Never use \`innerHTML\`, \`outerHTML\`, or \`insertAdjacentHTML\` in plugin code.
17. **Opaque auth headers can only be captured, not generated** — some apps use cryptographic tokens computed by obfuscated JS. Capture them from the XHR interceptor and implement a polling wait with timeout for the header to appear.
18. **When one API path is blocked, find another** — if a write operation requires an undocumented cryptographic payload, don't give up. Explore the web app's internal extension APIs, JavaScript-exposed programmatic interfaces, or other internal endpoints. Complex apps usually expose higher-level APIs for extensions/accessibility. Use \`browser_execute_script\` to enumerate non-standard page globals.
19. **Web apps expose programmatic extension APIs on the page** — complex web apps often expose internal scripting APIs on \`window\` that provide higher-level operations than raw XHR endpoints. Discovery: use \`browser_execute_script\` with \`Object.keys(window).filter(...)\` to find non-standard globals, then explore their methods.
20. **Internal API endpoints can be deprecated without warning** — when building plugins for web apps with multiple API generations, test each endpoint independently. If an endpoint returns 404 or 403, it may be deprecated for that account or region. Remove tools that depend on deprecated endpoints rather than shipping broken tools.

---

## Phase 7: Write Learnings Back (Mandatory)

Every plugin build surfaces new patterns, gotchas, and techniques. You **must** write them back so the next AI session benefits automatically.

**Invoke the \`contribute_learnings\` prompt now** with the task description (e.g., \`contribute_learnings(task: "built a plugin for <DisplayName>")\`). That prompt provides the complete self-improvement workflow: which files to edit, the file-to-resource mapping, rules for deduplication, and verification steps.

Do not skip this phase. The source files you edit compile into the MCP resources and prompts this server serves. You are reading this prompt because a previous session wrote or improved it — your additions reach the next agent the same way.`;
};
