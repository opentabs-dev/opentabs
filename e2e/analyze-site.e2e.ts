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
    isSpa: boolean;
    isSsr: boolean;
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
