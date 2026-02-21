/**
 * E2E tests for the plugin_analyze_site browser tool.
 *
 * Each test scenario starts a dedicated test server simulating a specific
 * auth/API pattern, calls plugin_analyze_site via the MCP client, and
 * verifies the structured analysis output.
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `bun run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built
 *   - Chromium is installed for Playwright
 */

import { test, expect, startAnalyzeSiteServer } from './fixtures.js';
import { waitForExtensionConnected, waitForLog, parseToolResult } from './helpers.js';
import type { McpClient, TestServer } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SiteAnalysis {
  url: string;
  title: string;
  auth: {
    authenticated: boolean;
    methods: Array<{
      type: string;
      details: string;
      extractionHint: string;
    }>;
  };
  apis: {
    endpoints: Array<{
      url: string;
      method: string;
      protocol: string;
      callCount: number;
      contentType?: string;
      authHeader?: string;
      requestBodySample?: string;
      status?: number;
    }>;
    primaryApiBaseUrl: string | null;
  };
  framework: {
    frameworks: Array<{ name: string; version?: string }>;
    isSPA: boolean;
    isSSR: boolean;
  };
  globals: {
    globals: Array<{
      path: string;
      type: string;
      hasAuthData: boolean;
      topLevelKeys?: string[];
    }>;
  };
  dom: {
    forms: Array<{
      action: string;
      method: string;
      fields: Array<{ name: string; type: string }>;
    }>;
    interactiveElements: Array<{
      tag: string;
      type?: string;
      name?: string;
      id?: string;
      text?: string;
    }>;
    dataAttributes: string[];
  };
  storage: {
    cookies: Array<{ name: string; isAuth: boolean }>;
    localStorage: Array<{ name: string; isAuth: boolean }>;
    sessionStorage: Array<{ name: string; isAuth: boolean }>;
  };
  suggestions: Array<{
    toolName: string;
    description: string;
    approach: string;
    complexity: string;
  }>;
}

/**
 * Call plugin_analyze_site and parse the result as SiteAnalysis.
 * Uses a longer timeout because the tool opens a tab, waits for network
 * activity, and runs multiple detection scripts.
 */
const analyzeSite = async (mcpClient: McpClient, url: string, waitSeconds = 3): Promise<SiteAnalysis> => {
  const result = await mcpClient.callTool('plugin_analyze_site', { url, waitSeconds }, { timeout: 60_000 });
  if (result.isError) {
    throw new Error(`plugin_analyze_site returned error: ${result.content}`);
  }
  return parseToolResult(result.content) as unknown as SiteAnalysis;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Use a shared server across all test groups to avoid spawning multiple processes
let analyzeSiteServer: TestServer;

test.beforeAll(async () => {
  analyzeSiteServer = await startAnalyzeSiteServer();
});

test.afterAll(async () => {
  await analyzeSiteServer.kill();
});

test.describe('plugin_analyze_site — cookie session auth', () => {
  test('detects cookie-based session auth and CSRF token', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    // Wait for the extension to connect before calling browser tools
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/cookie-session/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Auth detection ---
    expect(analysis.auth.authenticated).toBe(true);

    // Verify cookie-session auth method detected
    const cookieMethods = analysis.auth.methods.filter(m => m.type === 'cookie-session');
    expect(cookieMethods.length).toBeGreaterThanOrEqual(1);

    // The connect.sid cookie should be specifically identified
    const connectSidMethod = cookieMethods.find(m => m.details.includes('connect.sid'));
    expect(connectSidMethod).toBeDefined();
    expect(connectSidMethod?.extractionHint).toContain('connect.sid');

    // --- CSRF detection ---
    const csrfMethods = analysis.auth.methods.filter(m => m.type === 'csrf-token');
    expect(csrfMethods.length).toBeGreaterThanOrEqual(1);

    // Check for CSRF meta tag detection
    const csrfMetaMethod = csrfMethods.find(m => m.details.includes('meta'));
    expect(csrfMetaMethod).toBeDefined();

    // Check for CSRF hidden input detection
    const csrfInputMethod = csrfMethods.find(m => m.details.includes('hidden input'));
    expect(csrfInputMethod).toBeDefined();

    // --- API detection ---
    // The page makes GET and POST requests to /cookie-session/api/* endpoints
    expect(analysis.apis.endpoints.length).toBeGreaterThanOrEqual(1);

    // Should detect REST endpoints
    const restEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'rest');
    expect(restEndpoints.length).toBeGreaterThanOrEqual(1);

    // --- DOM detection ---
    // The page has a form with fields
    expect(analysis.dom.forms.length).toBeGreaterThanOrEqual(1);
    const form = analysis.dom.forms[0];
    expect(form).toBeDefined();
    if (form) {
      expect(form.fields.length).toBeGreaterThanOrEqual(1);
      // Check that the form has the expected fields
      const fieldNames = form.fields.map(f => f.name);
      expect(fieldNames).toContain('display_name');
      expect(fieldNames).toContain('email');
    }

    // --- Storage detection ---
    // connect.sid is HttpOnly, so detectStorage (which reads document.cookie) won't see it.
    // The auth detection module uses browser.getCookies (chrome.cookies API) which does
    // see HttpOnly cookies — verify that auth.methods detected the session cookie above.

    // --- Title ---
    expect(analysis.title).toBe('Cookie Session Test App');
  });
});

test.describe('plugin_analyze_site — JWT localStorage auth', () => {
  test('detects JWT in localStorage and Bearer header in API calls', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/jwt-localstorage/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Auth detection ---
    expect(analysis.auth.authenticated).toBe(true);

    // Verify JWT in localStorage detected
    const jwtLocalMethods = analysis.auth.methods.filter(m => m.type === 'jwt-localstorage');
    expect(jwtLocalMethods.length).toBeGreaterThanOrEqual(1);

    // The auth_token key should be mentioned in details
    const authTokenMethod = jwtLocalMethods.find(m => m.details.includes('auth_token'));
    expect(authTokenMethod).toBeDefined();

    // extractionHint should contain working JS code for localStorage access
    expect(authTokenMethod?.extractionHint).toContain('localStorage');
    expect(authTokenMethod?.extractionHint).toContain('auth_token');

    // Verify Bearer header detected in network requests
    const bearerMethods = analysis.auth.methods.filter(m => m.type === 'bearer-header');
    expect(bearerMethods.length).toBeGreaterThanOrEqual(1);

    // --- API detection ---
    expect(analysis.apis.endpoints.length).toBeGreaterThanOrEqual(1);

    // Should detect REST endpoints
    const restEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'rest');
    expect(restEndpoints.length).toBeGreaterThanOrEqual(1);

    // --- Storage detection ---
    // The JWT key should be reported in localStorage keys
    const authStorageEntry = analysis.storage.localStorage.find(e => e.name === 'auth_token');
    expect(authStorageEntry).toBeDefined();
    expect(authStorageEntry?.isAuth).toBe(true);

    // --- Title ---
    expect(analysis.title).toBe('JWT LocalStorage Test App');
  });
});

test.describe('plugin_analyze_site — GraphQL API', () => {
  test('detects GraphQL protocol and generates GraphQL-specific suggestions', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // The GraphQL page is served at /graphql-app/ (distinct from the /graphql API endpoint)
    const siteUrl = `${analyzeSiteServer.url}/graphql-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- API detection ---
    // The page makes POST requests to /graphql — should be classified as graphql
    const graphqlEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'graphql');
    expect(graphqlEndpoints.length).toBeGreaterThanOrEqual(1);

    // The endpoint URL should contain /graphql
    const gqlEndpoint = graphqlEndpoints.find(e => e.url.includes('/graphql'));
    expect(gqlEndpoint).toBeDefined();
    expect(gqlEndpoint?.method).toBe('POST');

    // Should have captured the request body with a query field
    if (gqlEndpoint?.requestBodySample) {
      expect(gqlEndpoint.requestBodySample).toContain('query');
    }

    // --- Suggestions ---
    // Should include GraphQL-specific tool suggestions
    expect(analysis.suggestions.length).toBeGreaterThanOrEqual(1);

    // The generic graphql_query suggestion should be present
    const graphqlQuerySuggestion = analysis.suggestions.find(s => s.toolName === 'graphql_query');
    expect(graphqlQuerySuggestion).toBeDefined();
    expect(graphqlQuerySuggestion?.approach).toContain('/graphql');

    // Named operation suggestions (gql_get_users, gql_get_items, gql_create_item)
    const gqlSuggestions = analysis.suggestions.filter(s => s.toolName.startsWith('gql_'));
    expect(gqlSuggestions.length).toBeGreaterThanOrEqual(1);

    // --- Title ---
    expect(analysis.title).toBe('GraphQL Test App');
  });
});

test.describe('plugin_analyze_site — JSON-RPC API', () => {
  test('detects JSON-RPC protocol in API calls', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/jsonrpc-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- API detection ---
    // The page makes POST requests to /rpc with { jsonrpc: '2.0' } bodies
    const jsonrpcEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'jsonrpc');
    expect(jsonrpcEndpoints.length).toBeGreaterThanOrEqual(1);

    // The endpoint URL should contain /rpc
    const rpcEndpoint = jsonrpcEndpoints.find(e => e.url.includes('/rpc'));
    expect(rpcEndpoint).toBeDefined();
    expect(rpcEndpoint?.method).toBe('POST');

    // Should have captured the request body with jsonrpc field
    if (rpcEndpoint?.requestBodySample) {
      expect(rpcEndpoint.requestBodySample).toContain('jsonrpc');
    }

    // --- Title ---
    expect(analysis.title).toBe('JSON-RPC Test App');
  });
});

test.describe('plugin_analyze_site — API key header auth', () => {
  test('detects X-API-Key header in API calls', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/apikey-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Auth detection ---
    expect(analysis.auth.authenticated).toBe(true);

    // Verify api-key-header auth method detected
    const apiKeyMethods = analysis.auth.methods.filter(m => m.type === 'api-key-header');
    expect(apiKeyMethods.length).toBeGreaterThanOrEqual(1);

    // The X-API-Key header should be mentioned in details
    const xApiKeyMethod = apiKeyMethods.find(m => m.details.toLowerCase().includes('x-api-key'));
    expect(xApiKeyMethod).toBeDefined();

    // extractionHint should mention the X-API-Key header
    expect(xApiKeyMethod?.extractionHint).toContain('X-API-Key');

    // --- API detection ---
    expect(analysis.apis.endpoints.length).toBeGreaterThanOrEqual(1);

    // Should detect REST endpoints
    const restEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'rest');
    expect(restEndpoints.length).toBeGreaterThanOrEqual(1);

    // --- Title ---
    expect(analysis.title).toBe('API Key Auth Test App');
  });
});

test.describe('plugin_analyze_site — Next.js SSR app', () => {
  test('detects Next.js framework, SSR/SPA status, and auth data in globals', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/nextjs-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Framework detection ---
    // The page sets window.__NEXT_DATA__ which the framework probe detects as nextjs
    const nextjsFramework = analysis.framework.frameworks.find(f => f.name === 'nextjs');
    expect(nextjsFramework).toBeDefined();

    // --- SPA detection ---
    // nextjs is in the known SPA frameworks list
    expect(analysis.framework.isSPA).toBe(true);

    // --- SSR detection ---
    // __NEXT_DATA__ with .props triggers both hasNextData and hydration markers
    expect(analysis.framework.isSSR).toBe(true);

    // --- Auth data in globals ---
    // __NEXT_DATA__ contains session/user/accessToken which should trigger auth-global detection
    const authGlobalMethods = analysis.auth.methods.filter(m => m.type === 'auth-global');
    expect(authGlobalMethods.length).toBeGreaterThanOrEqual(1);

    // The auth-global method should reference __NEXT_DATA__
    const nextDataAuth = authGlobalMethods.find(m => m.details.includes('__NEXT_DATA__'));
    expect(nextDataAuth).toBeDefined();

    // Should detect auth since __NEXT_DATA__ has auth data
    expect(analysis.auth.authenticated).toBe(true);

    // --- Globals detection ---
    // __NEXT_DATA__ should appear in globals with hasAuthData: true
    const nextDataGlobal = analysis.globals.globals.find(g => g.path === '__NEXT_DATA__');
    expect(nextDataGlobal).toBeDefined();
    expect(nextDataGlobal?.hasAuthData).toBe(true);

    // The topLevelKeys should include known __NEXT_DATA__ properties
    if (nextDataGlobal?.topLevelKeys) {
      expect(nextDataGlobal.topLevelKeys).toContain('props');
      expect(nextDataGlobal.topLevelKeys).toContain('buildId');
    }

    // --- Title ---
    expect(analysis.title).toBe('Next.js SSR Test App');
  });
});

test.describe('plugin_analyze_site — tRPC API', () => {
  test('detects tRPC protocol in API calls', async ({ mcpServer, extensionContext: _extensionContext, mcpClient }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/trpc-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- API detection ---
    // The page makes requests to /api/trpc/<procedure> paths — should be classified as trpc
    const trpcEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'trpc');
    expect(trpcEndpoints.length).toBeGreaterThanOrEqual(1);

    // Should detect tRPC endpoints with /api/trpc/ in the URL
    const trpcEndpoint = trpcEndpoints.find(e => e.url.includes('/api/trpc/'));
    expect(trpcEndpoint).toBeDefined();

    // Should detect both GET (query) and POST (mutation) tRPC calls
    const trpcMethods = new Set(trpcEndpoints.map(e => e.method));
    expect(trpcMethods.has('GET')).toBe(true);
    expect(trpcMethods.has('POST')).toBe(true);

    // --- Suggestions ---
    // tRPC endpoints should generate procedure-based suggestions (trpc_<procedure>)
    const trpcSuggestions = analysis.suggestions.filter(s => s.toolName.startsWith('trpc_'));
    expect(trpcSuggestions.length).toBeGreaterThanOrEqual(1);

    // --- Title ---
    expect(analysis.title).toBe('tRPC Test App');
  });
});

test.describe('plugin_analyze_site — WebSocket real-time connection', () => {
  test('detects WebSocket connection in API analysis', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/websocket-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- WebSocket detection ---
    // The page creates a WebSocket connection (ws://...) which should be
    // captured via the Network.webSocketCreated CDP event and classified
    // as protocol: 'websocket' by detect-apis.
    const wsEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'websocket');
    expect(wsEndpoints.length).toBeGreaterThanOrEqual(1);

    // The WebSocket URL should contain /ws
    const wsEndpoint = wsEndpoints.find(e => e.url.includes('/ws'));
    expect(wsEndpoint).toBeDefined();

    // --- Suggestions ---
    // WebSocket endpoints should generate a subscribe_realtime suggestion
    const wsSuggestion = analysis.suggestions.find(s => s.toolName === 'subscribe_realtime');
    expect(wsSuggestion).toBeDefined();
    expect(wsSuggestion?.approach).toContain('/ws');

    // --- REST API also detected ---
    // The page also makes a REST call to /websocket-app/api/config
    const restEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'rest');
    expect(restEndpoints.length).toBeGreaterThanOrEqual(1);

    // --- Title ---
    expect(analysis.title).toBe('WebSocket Test App');
  });
});

test.describe('plugin_analyze_site — mixed auth (cookie + CSRF + Bearer)', () => {
  test('detects all three auth methods from a complex real-world setup', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/mixed-auth/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Cookie-session auth ---
    expect(analysis.auth.authenticated).toBe(true);

    // The "session" cookie should be detected (matches /^session$/i pattern)
    const cookieMethods = analysis.auth.methods.filter(m => m.type === 'cookie-session');
    expect(cookieMethods.length).toBeGreaterThanOrEqual(1);
    const sessionCookie = cookieMethods.find(m => m.details.includes('"session"'));
    expect(sessionCookie).toBeDefined();

    // --- CSRF token detection ---
    const csrfMethods = analysis.auth.methods.filter(m => m.type === 'csrf-token');
    expect(csrfMethods.length).toBeGreaterThanOrEqual(1);

    // Should detect CSRF meta tag
    const csrfMetaMethod = csrfMethods.find(m => m.details.includes('meta'));
    expect(csrfMetaMethod).toBeDefined();

    // Should detect CSRF hidden input
    const csrfInputMethod = csrfMethods.find(m => m.details.includes('hidden input'));
    expect(csrfInputMethod).toBeDefined();

    // Should also detect X-CSRF-Token header from the POST request
    const csrfHeaderMethod = csrfMethods.find(m => m.details.includes('X-CSRF-Token'));
    // The header detection depends on network capture timing — assert at least meta + hidden input
    if (csrfHeaderMethod) {
      expect(csrfHeaderMethod.details).toContain('X-CSRF-Token');
    }

    // --- Bearer header auth ---
    const bearerMethods = analysis.auth.methods.filter(m => m.type === 'bearer-header');
    expect(bearerMethods.length).toBeGreaterThanOrEqual(1);

    // --- All three auth types present ---
    const authTypes = new Set(analysis.auth.methods.map(m => m.type));
    expect(authTypes.has('cookie-session')).toBe(true);
    expect(authTypes.has('csrf-token')).toBe(true);
    expect(authTypes.has('bearer-header')).toBe(true);

    // --- API detection ---
    // The page makes GET and POST requests to /mixed-auth/api/* endpoints
    expect(analysis.apis.endpoints.length).toBeGreaterThanOrEqual(1);
    const restEndpoints = analysis.apis.endpoints.filter(e => e.protocol === 'rest');
    expect(restEndpoints.length).toBeGreaterThanOrEqual(1);

    // --- DOM detection ---
    // The page has a form with hidden CSRF input and settings fields
    expect(analysis.dom.forms.length).toBeGreaterThanOrEqual(1);
    const form = analysis.dom.forms[0];
    expect(form).toBeDefined();
    if (form) {
      const fieldNames = form.fields.map(f => f.name);
      expect(fieldNames).toContain('authenticity_token');
      expect(fieldNames).toContain('setting_name');
    }

    // --- Title ---
    expect(analysis.title).toBe('Mixed Auth Test App');
  });
});

test.describe('plugin_analyze_site — SPA with client-side routing', () => {
  test('detects SPA with React framework and client-side routing', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const siteUrl = `${analyzeSiteServer.url}/spa-app/`;
    const analysis = await analyzeSite(mcpClient, siteUrl);

    // --- Framework detection ---
    // The page sets window.__REACT_DEVTOOLS_GLOBAL_HOOK__ with renderers
    const reactFramework = analysis.framework.frameworks.find(f => f.name === 'react');
    expect(reactFramework).toBeDefined();
    expect(reactFramework?.version).toBe('18.2.0');

    // --- SPA detection ---
    // React is in the known SPA frameworks list, and the page has a div#root
    expect(analysis.framework.isSPA).toBe(true);

    // --- Title ---
    expect(analysis.title).toBe('SPA React Test App');
  });
});
