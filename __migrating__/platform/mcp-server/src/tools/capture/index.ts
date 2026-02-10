// =============================================================================
// Capture Tools — AI-Assisted Plugin Creation
//
// Platform-native MCP tools that enable AI agents to autonomously create
// OpenTabs plugins by observing a target web application. The end-to-end flow:
//
//   1. Start capture mode on a browser tab (records HTTP requests/responses)
//   2. The user navigates the target web app while capture is active
//   3. Stop capture and retrieve the captured traffic
//   4. Analyze the captured data to discover API endpoints and auth patterns
//   5. Scaffold a v0 plugin from the discovered API catalog
//   6. Install, build, test, and iterate on the plugin
//
// These tools are part of the platform infrastructure — they're not a plugin.
// They communicate with the Chrome extension's background script via the
// browser controller (sendBrowserRequest) for capture operations, and use
// the create-opentabs-plugin scaffolder for plugin generation.
//
// Capture mode works by injecting a performance observer and fetch/XHR
// interceptors into the target page. The intercepted requests are stored
// in the extension's background script and retrievable via these tools.
// =============================================================================

import { createToolRegistrar, sendBrowserRequest, success, error } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// -----------------------------------------------------------------------------
// Types — Captured request/response data
// -----------------------------------------------------------------------------

/** A single captured HTTP request with its response. */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly statusText: string;
  readonly requestHeaders: Record<string, string>;
  readonly responseHeaders: Record<string, string>;
  readonly requestBody?: string;
  readonly responseBody?: string;
  readonly contentType?: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly initiator?: string;
}

/** Summary of captured traffic for a tab. */
interface CaptureSummary {
  readonly tabId: number;
  readonly tabUrl: string;
  readonly totalRequests: number;
  readonly capturing: boolean;
  readonly startedAt: number;
  readonly duration: number;
}

/** An API endpoint discovered from captured traffic. */
interface DiscoveredEndpoint {
  readonly path: string;
  readonly method: string;
  readonly domain: string;
  readonly queryParams: readonly string[];
  readonly requestContentType?: string;
  readonly responseContentType?: string;
  readonly statusCodes: readonly number[];
  readonly sampleCount: number;
  readonly hasRequestBody: boolean;
  readonly hasResponseBody: boolean;
  readonly authHeaders: readonly string[];
}

/** Auth pattern discovered from request headers. */
interface DiscoveredAuthPattern {
  readonly type: 'bearer' | 'cookie' | 'api-key' | 'csrf' | 'custom';
  readonly headerName: string;
  readonly description: string;
  readonly sampleValue?: string;
}

/** Full API catalog from analysis. */
interface ApiCatalog {
  readonly domain: string;
  readonly basePath: string;
  readonly endpoints: readonly DiscoveredEndpoint[];
  readonly authPatterns: readonly DiscoveredAuthPattern[];
  readonly totalRequests: number;
  readonly uniqueEndpoints: number;
}

// -----------------------------------------------------------------------------
// Analysis Helpers
// -----------------------------------------------------------------------------

/**
 * Normalize a URL path by removing query params and collapsing likely
 * dynamic segments (UUIDs, numeric IDs) into parameter placeholders.
 */
const normalizePath = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[A-Z][A-Z0-9]{8,}/g, '/:id');
  } catch {
    return url;
  }
};

/**
 * Extract query parameter names from a URL.
 */
const extractQueryParams = (url: string): string[] => {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.keys()];
  } catch {
    return [];
  }
};

/**
 * Detect authentication patterns from request headers.
 */
const detectAuthPatterns = (requests: readonly CapturedRequest[]): DiscoveredAuthPattern[] => {
  const patterns = new Map<string, DiscoveredAuthPattern>();

  for (const req of requests) {
    const headers = req.requestHeaders;

    // Bearer token
    const authHeader = headers['authorization'] ?? headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      patterns.set('bearer', {
        type: 'bearer',
        headerName: 'Authorization',
        description: 'Bearer token in Authorization header',
        sampleValue: `Bearer ${authHeader.slice(7, 20)}...`,
      });
    }

    // API key header (common patterns)
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (lower.includes('x-api-key') || lower.includes('api-key') || lower.includes('apikey')) {
        patterns.set('api-key', {
          type: 'api-key',
          headerName: name,
          description: `API key in ${name} header`,
          sampleValue: value ? `${value.slice(0, 10)}...` : undefined,
        });
      }

      // CSRF token
      if (lower.includes('csrf') || lower.includes('x-xsrf') || lower.includes('x-csrf')) {
        patterns.set('csrf', {
          type: 'csrf',
          headerName: name,
          description: `CSRF token in ${name} header`,
        });
      }
    }

    // Cookie-based auth (if cookies are present and no other auth mechanism)
    const cookie = headers['cookie'] ?? headers['Cookie'];
    if (cookie && !patterns.has('bearer') && !patterns.has('api-key')) {
      patterns.set('cookie', {
        type: 'cookie',
        headerName: 'Cookie',
        description: 'Cookie-based session authentication (credentials: include)',
      });
    }
  }

  return [...patterns.values()];
};

/**
 * Group captured requests into API endpoints, deduplicating and summarizing.
 */
const groupEndpoints = (requests: readonly CapturedRequest[]): DiscoveredEndpoint[] => {
  const groups = new Map<
    string,
    {
      path: string;
      method: string;
      domain: string;
      queryParams: Set<string>;
      requestContentType: string | undefined;
      responseContentType: string | undefined;
      statusCodes: Set<number>;
      count: number;
      hasRequestBody: boolean;
      hasResponseBody: boolean;
      authHeaders: Set<string>;
    }
  >();

  for (const req of requests) {
    const normalized = normalizePath(req.url);
    let domain: string;
    try {
      domain = new URL(req.url).hostname;
    } catch {
      continue;
    }

    const key = `${req.method} ${domain}${normalized}`;
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
      existing.statusCodes.add(req.status);
      for (const param of extractQueryParams(req.url)) {
        existing.queryParams.add(param);
      }
      if (req.requestBody) existing.hasRequestBody = true;
      if (req.responseBody) existing.hasResponseBody = true;
    } else {
      const authHeaders = new Set<string>();
      const headers = req.requestHeaders;
      if (headers['authorization'] || headers['Authorization']) authHeaders.add('Authorization');
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (lower.includes('csrf') || lower.includes('api-key') || lower.includes('apikey')) {
          authHeaders.add(name);
        }
      }

      groups.set(key, {
        path: normalized,
        method: req.method,
        domain,
        queryParams: new Set(extractQueryParams(req.url)),
        requestContentType: req.requestHeaders['content-type'] ?? req.requestHeaders['Content-Type'],
        responseContentType: req.contentType,
        statusCodes: new Set([req.status]),
        count: 1,
        hasRequestBody: !!req.requestBody,
        hasResponseBody: !!req.responseBody,
        authHeaders,
      });
    }
  }

  return [...groups.values()].map(g => ({
    path: g.path,
    method: g.method,
    domain: g.domain,
    queryParams: [...g.queryParams],
    requestContentType: g.requestContentType,
    responseContentType: g.responseContentType,
    statusCodes: [...g.statusCodes].sort(),
    sampleCount: g.count,
    hasRequestBody: g.hasRequestBody,
    hasResponseBody: g.hasResponseBody,
    authHeaders: [...g.authHeaders],
  }));
};

/**
 * Build a full API catalog from captured requests.
 */
const buildApiCatalog = (requests: readonly CapturedRequest[], tabUrl: string): ApiCatalog => {
  // Filter to only API-like requests (JSON, form data, not static assets)
  const apiRequests = requests.filter(req => {
    const ct = req.contentType ?? '';
    const url = req.url.toLowerCase();

    // Include JSON API responses
    if (ct.includes('application/json')) return true;
    // Include form submissions
    if (ct.includes('application/x-www-form-urlencoded')) return true;
    // Include GraphQL
    if (url.includes('/graphql')) return true;
    // Include paths that look like API endpoints
    if (url.includes('/api/') || url.includes('/v1/') || url.includes('/v2/') || url.includes('/v3/')) return true;
    // Exclude static assets
    if (
      ct.includes('text/html') ||
      ct.includes('text/css') ||
      ct.includes('javascript') ||
      ct.includes('image/') ||
      ct.includes('font/')
    ) {
      return false;
    }
    // Include XHR/fetch requests with non-GET methods
    if (req.method !== 'GET') return true;

    return false;
  });

  let domain: string;
  try {
    domain = new URL(tabUrl).hostname;
  } catch {
    domain = 'unknown';
  }

  let basePath = '/';
  // Try to detect a common API base path
  const pathCounts = new Map<string, number>();
  for (const req of apiRequests) {
    try {
      const segments = new URL(req.url).pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const prefix = `/${segments[0]}`;
        pathCounts.set(prefix, (pathCounts.get(prefix) ?? 0) + 1);
      }
    } catch {
      // skip
    }
  }
  let maxCount = 0;
  for (const [prefix, count] of pathCounts) {
    if (count > maxCount && (prefix.includes('api') || prefix.includes('v1') || prefix.includes('v2'))) {
      basePath = prefix;
      maxCount = count;
    }
  }

  const endpoints = groupEndpoints(apiRequests);
  const authPatterns = detectAuthPatterns(apiRequests);

  return {
    domain,
    basePath,
    endpoints,
    authPatterns,
    totalRequests: apiRequests.length,
    uniqueEndpoints: endpoints.length,
  };
};

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

export const registerCaptureTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // =========================================================================
  // Capture Control Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Start capture
  // -------------------------------------------------------------------------

  define(
    'capture_start',
    {
      description:
        'Start capturing HTTP requests on a browser tab. This injects request ' +
        'interceptors into the page that record all fetch/XHR requests, their ' +
        'headers, bodies, and responses.\n\n' +
        'Use browser_list_tabs to find the tab ID of the target web application ' +
        'first. After starting capture, navigate the application to exercise its ' +
        'API endpoints. Then use capture_stop and capture_analyze to extract the ' +
        'API catalog.\n\n' +
        'This is the first step in the AI-assisted plugin creation workflow.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to capture requests on — find via browser_list_tabs'),
        includeResponseBodies: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Whether to capture response bodies (can be large). Default: false. ' +
              'Enable for detailed API response analysis.',
          ),
        maxRequests: z
          .number()
          .optional()
          .default(500)
          .describe('Maximum number of requests to capture before auto-stopping (default: 500)'),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ tabId, includeResponseBodies, maxRequests }) => {
      const result = await sendBrowserRequest<{
        capturing: boolean;
        tabId: number;
        message: string;
      }>('startCapture', {
        tabId,
        includeResponseBodies: includeResponseBodies ?? false,
        maxRequests: maxRequests ?? 500,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Stop capture
  // -------------------------------------------------------------------------

  define(
    'capture_stop',
    {
      description:
        'Stop capturing HTTP requests on a browser tab. Returns a summary of ' +
        'what was captured including total request count and capture duration.\n\n' +
        'After stopping, use capture_get_requests to retrieve the raw captured data, ' +
        'or capture_analyze for an analyzed API catalog.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to stop capturing on'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<CaptureSummary>('stopCapture', { tabId });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Get capture status
  // -------------------------------------------------------------------------

  define(
    'capture_status',
    {
      description:
        'Check the current capture status for a browser tab — whether capture ' +
        'is active and how many requests have been recorded so far.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to check capture status for'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<CaptureSummary>('captureStatus', { tabId });
      return success(result);
    },
  );

  // =========================================================================
  // Captured Data Retrieval Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Get captured requests (raw data)
  // -------------------------------------------------------------------------

  define(
    'capture_get_requests',
    {
      description:
        'Retrieve captured HTTP requests from a tab. Returns the raw request/response ' +
        'data including URLs, methods, headers, status codes, and optionally bodies.\n\n' +
        'Use filters to narrow results (e.g. only JSON responses, only specific domains, ' +
        'only non-GET methods). For an analyzed summary instead of raw data, use ' +
        'capture_analyze.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to get captured requests from'),
        limit: z.number().optional().default(50).describe('Maximum number of requests to return (default: 50)'),
        offset: z.number().optional().default(0).describe('Offset for pagination (default: 0)'),
        methodFilter: z.string().optional().describe('Filter by HTTP method (e.g. "POST", "GET")'),
        domainFilter: z.string().optional().describe('Filter by domain substring (e.g. "api.example.com")'),
        pathFilter: z.string().optional().describe('Filter by URL path substring (e.g. "/api/v1")'),
        contentTypeFilter: z.string().optional().describe('Filter by response content type (e.g. "application/json")'),
        excludeStaticAssets: z
          .boolean()
          .optional()
          .default(true)
          .describe('Exclude static assets (images, CSS, JS, fonts). Default: true'),
      },
    },
    async ({
      tabId,
      limit,
      offset,
      methodFilter,
      domainFilter,
      pathFilter,
      contentTypeFilter,
      excludeStaticAssets,
    }) => {
      const result = await sendBrowserRequest<{
        requests: CapturedRequest[];
        total: number;
        filtered: number;
      }>('getCapturedRequests', {
        tabId,
        limit: limit ?? 50,
        offset: offset ?? 0,
        methodFilter,
        domainFilter,
        pathFilter,
        contentTypeFilter,
        excludeStaticAssets: excludeStaticAssets ?? true,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Clear captured requests
  // -------------------------------------------------------------------------

  define(
    'capture_clear',
    {
      description:
        'Clear all captured requests for a tab. Use this to start a fresh ' +
        'capture session without stopping and restarting the interceptors.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to clear captured requests for'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<{ cleared: number }>('clearCapture', { tabId });
      return success(result);
    },
  );

  // =========================================================================
  // Analysis Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Analyze captured traffic — produce API catalog
  // -------------------------------------------------------------------------

  define(
    'capture_analyze',
    {
      description:
        'Analyze captured HTTP traffic and produce a structured API catalog.\n\n' +
        'This processes the raw captured requests into:\n' +
        '- Discovered API endpoints (paths, methods, parameter patterns)\n' +
        '- Authentication patterns (Bearer tokens, cookies, CSRF, API keys)\n' +
        '- Request/response content types\n' +
        '- Common base paths and domain groupings\n\n' +
        'The catalog is the foundation for scaffolding a new plugin. Use ' +
        'capture_start first to record traffic, then call this tool to analyze it.\n\n' +
        'For more control over the analysis, retrieve raw requests with ' +
        'capture_get_requests and analyze them yourself.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to analyze captured traffic for'),
      },
    },
    async ({ tabId }) => {
      // Retrieve all captured requests for analysis
      const rawResult = await sendBrowserRequest<{
        requests: CapturedRequest[];
        total: number;
        tabUrl: string;
      }>('getCapturedRequests', {
        tabId,
        limit: 10000,
        offset: 0,
        excludeStaticAssets: true,
      });

      if (!rawResult.requests || rawResult.requests.length === 0) {
        return success({
          message:
            'No API requests captured. Make sure capture_start was called before ' +
            'navigating the target web application, and that the app made API calls.',
          totalRequests: 0,
        });
      }

      const catalog = buildApiCatalog(rawResult.requests, rawResult.tabUrl ?? '');

      return success({
        catalog,
        summary: {
          domain: catalog.domain,
          basePath: catalog.basePath,
          totalApiRequests: catalog.totalRequests,
          uniqueEndpoints: catalog.uniqueEndpoints,
          authPatterns: catalog.authPatterns.map(p => `${p.type}: ${p.description}`),
          topEndpoints: [...catalog.endpoints]
            .sort((a, b) => b.sampleCount - a.sampleCount)
            .slice(0, 20)
            .map(
              (e: (typeof catalog.endpoints)[number]) =>
                `${e.method} ${e.path} (${e.sampleCount}x, status: ${e.statusCodes.join('/')})`,
            ),
        },
      });
    },
  );

  // =========================================================================
  // Page Inspection Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Get page JavaScript resources
  // -------------------------------------------------------------------------

  define(
    'capture_get_page_scripts',
    {
      description:
        'List JavaScript files loaded by the target web application. Returns URLs ' +
        'of all <script> elements and dynamically loaded JS resources.\n\n' +
        'Useful for finding API client code, endpoint definitions, and TypeScript ' +
        'type information embedded in the application bundle. After identifying ' +
        'interesting scripts, use capture_fetch_script to retrieve their contents ' +
        'for analysis.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to list scripts for'),
        filterPattern: z
          .string()
          .optional()
          .describe(
            'Optional filter pattern for script URLs (e.g. "api", "client", "chunk"). ' +
              'Only scripts whose URL contains this string are returned.',
          ),
      },
    },
    async ({ tabId, filterPattern }) => {
      const result = await sendBrowserRequest<{ scripts: string[] }>('getPageScripts', {
        tabId,
        filterPattern,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Fetch and return a JS source file
  // -------------------------------------------------------------------------

  define(
    'capture_fetch_script',
    {
      description:
        'Fetch the contents of a JavaScript file loaded by the target web app. ' +
        'Use capture_get_page_scripts to find script URLs first.\n\n' +
        'The returned source code can be analyzed (via regex or manual inspection) ' +
        'to discover API endpoints, type definitions, and client code patterns ' +
        "that weren't exercised during capture.\n\n" +
        "Note: source may be minified. Look for API paths ('/api/v1/...'), " +
        'fetch/axios calls, and endpoint constant definitions.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab (used to make the request in the page context)'),
        url: z.string().describe('Full URL of the script to fetch'),
        maxLength: z
          .number()
          .optional()
          .default(100000)
          .describe('Maximum characters to return (default: 100000). Large bundles are truncated.'),
      },
    },
    async ({ tabId, url, maxLength }) => {
      const result = await sendBrowserRequest<{
        url: string;
        content: string;
        truncated: boolean;
        totalLength: number;
      }>('fetchScript', {
        tabId,
        url,
        maxLength: maxLength ?? 100000,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Inspect page auth state
  // -------------------------------------------------------------------------

  define(
    'capture_inspect_auth',
    {
      description:
        'Inspect the authentication state of the target web application.\n\n' +
        'Examines localStorage, sessionStorage, cookies, and meta tags to find ' +
        'auth tokens, session identifiers, and CSRF tokens. Returns a structured ' +
        'summary of discovered credentials and their storage locations.\n\n' +
        'This helps determine the correct auth extraction strategy for the ' +
        "plugin's adapter (getAuth function).\n\n" +
        'WARNING: Token values are partially redacted for security. The tool ' +
        'returns enough information to identify the auth mechanism without ' +
        'exposing full credential values.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to inspect auth state for'),
      },
      annotations: {
        destructiveHint: false,
        readOnlyHint: true,
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<{
        localStorage: Record<string, string>;
        sessionStorage: Record<string, string>;
        cookies: string[];
        metaTags: Record<string, string>;
        globals: Record<string, string>;
      }>('inspectAuth', { tabId });
      return success(result);
    },
  );

  // =========================================================================
  // Plugin Scaffolding Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Scaffold a new plugin
  // -------------------------------------------------------------------------

  define(
    'capture_scaffold_plugin',
    {
      description:
        'Scaffold a new OpenTabs plugin from the official template.\n\n' +
        'Generates a complete plugin directory with:\n' +
        '- opentabs-plugin.json manifest\n' +
        '- src/adapter.ts (MAIN world adapter script)\n' +
        '- src/tools/index.ts (tool entry point)\n' +
        '- src/tools/general.ts (example tool definitions)\n' +
        '- package.json, tsconfig.json, README.md\n\n' +
        'Template variables ({{pluginName}}, {{domain}}, etc.) are replaced with ' +
        'the provided values. After scaffolding, customize the adapter auth ' +
        'extraction and add specific tool definitions.\n\n' +
        'Use capture_analyze first to determine the correct domain, auth patterns, ' +
        'and API structure for the plugin.',
      inputSchema: {
        pluginName: z
          .string()
          .describe(
            'Plugin identifier — lowercase alphanumeric with hyphens ' +
              '(e.g. "jira", "google-sheets", "internal-dashboard")',
          ),
        domain: z
          .string()
          .describe(
            'Primary domain the plugin targets (e.g. "app.example.com", ".atlassian.net"). ' +
              'Use a leading dot for wildcard subdomains.',
          ),
        displayName: z
          .string()
          .optional()
          .describe('Human-readable name (e.g. "Jira", "Google Sheets"). Default: title-cased plugin name.'),
        description: z
          .string()
          .optional()
          .describe('Short plugin description. Default: "OpenTabs plugin for <displayName>"'),
        author: z.string().optional().describe('Author name or organization'),
        outputDir: z
          .string()
          .optional()
          .describe(
            'Output directory path. Default: ./opentabs-plugin-<name> relative to CWD. ' +
              'For monorepo development, use a path inside the plugins/ directory.',
          ),
      },
    },
    async ({ pluginName, domain, displayName, description, author, outputDir }) => {
      try {
        // Dynamically import the scaffolder to avoid a hard dependency
        // that would fail if create-opentabs-plugin isn't installed.
        // @ts-expect-error — create-opentabs-plugin is an optional peer dependency
        const { scaffoldPlugin } = (await import('create-opentabs-plugin')) as {
          scaffoldPlugin: (opts: {
            pluginName: string;
            domain: string;
            displayName?: string;
            description?: string;
            author?: string;
            outputDir?: string;
          }) => Promise<{ outputDir: string; pluginName: string; files: string[]; variables: Record<string, string> }>;
        };

        const result = await scaffoldPlugin({
          pluginName,
          domain,
          displayName,
          description,
          author,
          outputDir,
        });

        return success({
          message: `Plugin "${pluginName}" scaffolded successfully`,
          outputDir: result.outputDir,
          files: result.files,
          variables: result.variables,
          nextSteps: [
            `cd ${result.outputDir}`,
            'bun install',
            "Edit src/adapter.ts — implement getAuth() for the target app's auth mechanism",
            'Edit opentabs-plugin.json — verify domains and URL patterns',
            'Add tool definitions in src/tools/',
            'bun run build',
            'Test with capture_test_plugin',
          ],
        });
      } catch (err) {
        return error(err);
      }
    },
  );

  // =========================================================================
  // Plugin Development Lifecycle Tools
  // =========================================================================

  // -------------------------------------------------------------------------
  // Verify a locally installed plugin is wired correctly
  // -------------------------------------------------------------------------

  define(
    'capture_verify_plugin',
    {
      description:
        'Verify that a locally installed plugin is correctly wired into the platform.\n\n' +
        'Checks:\n' +
        '1. Whether the service is registered in the platform\n' +
        '2. Whether a matching browser tab is connected\n' +
        '3. Whether the adapter responds to a health check request\n\n' +
        'Use this after building and installing a plugin to diagnose issues ' +
        'before testing individual tools. Returns actionable diagnostics for ' +
        'each check that fails.\n\n' +
        'Workflow:\n' +
        '1. Build the plugin and MCP server\n' +
        '2. Call reload_extension\n' +
        '3. Open the target web app in Chrome and sign in\n' +
        '4. Call this tool to verify everything is connected',
      inputSchema: {
        serviceName: z.string().describe('Plugin/service name to verify (e.g. "jira", "slack")'),
      },
    },
    async ({ serviceName }) => {
      const checks: {
        name: string;
        passed: boolean;
        detail: string;
      }[] = [];

      // Check 1: Service connection status via the extension
      let serviceConnected = false;
      let tabId: number | undefined;
      let tabUrl: string | undefined;
      try {
        const statusResult = await sendBrowserRequest<{
          services: Record<
            string,
            {
              connected: boolean;
              tabId?: number;
              tabUrl?: string;
            }
          >;
          mcpConnected: boolean;
        }>('getStatus', {});

        const serviceStatus = statusResult.services?.[serviceName];

        checks.push({
          name: 'Extension connected',
          passed: statusResult.mcpConnected ?? false,
          detail: statusResult.mcpConnected
            ? 'Chrome extension is connected to the MCP server.'
            : 'Chrome extension is NOT connected. Ensure the extension is installed and the MCP server is running.',
        });

        if (serviceStatus) {
          serviceConnected = serviceStatus.connected;
          tabId = serviceStatus.tabId;
          tabUrl = serviceStatus.tabUrl;
          checks.push({
            name: 'Service registered',
            passed: true,
            detail: `Service "${serviceName}" is registered in the platform.`,
          });
          checks.push({
            name: 'Tab connected',
            passed: serviceStatus.connected,
            detail: serviceStatus.connected
              ? `Connected to tab ${serviceStatus.tabId} (${serviceStatus.tabUrl ?? 'unknown URL'}).`
              : `No matching tab found. Open the target web application in Chrome and sign in.`,
          });
        } else {
          checks.push({
            name: 'Service registered',
            passed: false,
            detail:
              `Service "${serviceName}" not found in the platform registry. ` +
              'Possible causes:\n' +
              '  - Plugin is not installed (bun add <package>)\n' +
              '  - Plugin manifest has a different "name" field\n' +
              '  - MCP server needs rebuilding (bun run build from packages/mcp-server/)\n' +
              '  - Extension needs reloading (call reload_extension)',
          });
        }
      } catch (err) {
        checks.push({
          name: 'Extension connected',
          passed: false,
          detail: `Failed to query extension status: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Check 2: If tab is connected, try a lightweight adapter ping
      if (serviceConnected && tabId) {
        try {
          const pingResult = await sendBrowserRequest<{
            result?: unknown;
            error?: string;
            logs: string[];
          }>('executeScript', {
            tabId,
            script: `return !!window.__openTabs?.adapters?.['${serviceName}']`,
          });

          const adapterLoaded = pingResult.result === true;
          checks.push({
            name: 'Adapter loaded',
            passed: adapterLoaded,
            detail: adapterLoaded
              ? `Adapter "${serviceName}" is registered on window.__openTabs.adapters.`
              : `Adapter "${serviceName}" is NOT found on the page. The adapter script may have failed to load. ` +
                'Check the browser console for errors.',
          });
        } catch (err) {
          checks.push({
            name: 'Adapter loaded',
            passed: false,
            detail: `Failed to check adapter: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      const allPassed = checks.every(c => c.passed);

      return success({
        serviceName,
        allPassed,
        checks,
        tabId,
        tabUrl,
        summary: allPassed
          ? `Plugin "${serviceName}" is fully operational. You can now call its tools directly.`
          : `Plugin "${serviceName}" has issues. See the checks above for diagnostics.`,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Get plugin development errors / debug info
  // -------------------------------------------------------------------------

  define(
    'capture_plugin_debug',
    {
      description:
        'Get debug information for plugin development. Returns:\n' +
        '- Whether the target service has a connected tab\n' +
        '- Recent adapter errors (if any)\n' +
        '- Health check status\n' +
        '- Extension connection status\n\n' +
        'Use this when a plugin tool is failing to diagnose the issue.',
      inputSchema: {
        serviceName: z.string().describe('Plugin/service name to debug (e.g. "jira", "slack")'),
      },
    },
    async ({ serviceName }) => {
      try {
        const statusResult = await sendBrowserRequest<{
          services: Record<
            string,
            {
              connected: boolean;
              tabId?: number;
              tabUrl?: string;
            }
          >;
          mcpConnected: boolean;
        }>('getStatus', {});

        const serviceStatus = statusResult.services?.[serviceName];

        return success({
          serviceName,
          mcpConnected: statusResult.mcpConnected ?? true,
          serviceConnected: serviceStatus?.connected ?? false,
          tabId: serviceStatus?.tabId,
          tabUrl: serviceStatus?.tabUrl,
          diagnostics: !serviceStatus
            ? `Service "${serviceName}" not found. It may not be installed or the plugin name may be incorrect.`
            : !serviceStatus.connected
              ? `Service "${serviceName}" is not connected. Open the target web application in Chrome and sign in.`
              : `Service "${serviceName}" is connected on tab ${serviceStatus.tabId}. The adapter should be functional.`,
        });
      } catch (err) {
        return error(err);
      }
    },
  );

  return tools;
};
