/**
 * {{displayName}} Adapter — MAIN world script
 *
 * Receives JSON-RPC requests from the background script and returns JSON-RPC
 * responses. Runs in the page's JS context with access to session cookies,
 * localStorage, and the page's JavaScript APIs.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api — Call the service's REST API
 */

import {
  ok,
  fail,
  registerAdapter,
  parseAction,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  INTERNAL_ERROR,
  NOT_AUTHENTICATED,
} from '@opentabs/plugin-sdk/adapter';
import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/plugin-sdk/adapter';

// ---------------------------------------------------------------------------
// Auth — Extract credentials from the page
//
// Adapt this section to match how the target web application stores its
// authentication tokens. Common patterns:
// - localStorage: the app stores a token in localStorage
// - Cookies: the app uses httpOnly cookies (just use credentials: 'include')
// - Meta tags: some SPAs inject tokens into <meta> tags
// - JavaScript globals: the app exposes auth on window.__APP_STATE__
// ---------------------------------------------------------------------------

interface AuthInfo {
  /** The authentication token (Bearer token, API key, or session cookie name). */
  readonly token: string;
  /** Base URL for API requests (typically the page origin). */
  readonly baseUrl: string;
}

/**
 * Extract authentication information from the page context.
 * Returns null if the user is not authenticated.
 *
 * Customize this function for your target web application.
 */
const getAuth = (): AuthInfo | null => {
  try {
    // Example: read a token from localStorage
    // const token = localStorage.getItem('auth_token');
    // if (!token) return null;
    // return { token, baseUrl: window.location.origin };

    // Example: read from a cookie-based session (no explicit token needed)
    // return { token: 'cookie-based', baseUrl: window.location.origin };

    // Placeholder — replace with actual auth extraction logic
    return {
      token: '',
      baseUrl: window.location.origin,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// API Transport
// ---------------------------------------------------------------------------

/**
 * Call the service's REST API using the user's authenticated session.
 *
 * @param endpoint - The API path (e.g. '/api/v1/users')
 * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param body - Optional request body (JSON-serializable)
 * @param headers - Optional extra headers
 * @returns The parsed JSON response
 */
const callApi = async (
  endpoint: string,
  method: string = 'GET',
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> => {
  const auth = getAuth();
  if (!auth || !auth.token) {
    return { error: 'Not authenticated' };
  }

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  // Add authorization header if using Bearer token auth
  if (auth.token !== 'cookie-based') {
    requestHeaders['Authorization'] = `Bearer ${auth.token}`;
  }

  const requestInit: RequestInit = {
    method,
    headers: requestHeaders,
    credentials: 'include', // Send cookies for cookie-based auth
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    requestInit.body = JSON.stringify(body);
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${auth.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const response = await fetch(url, requestInit);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      error: `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
      body: text,
    };
  }

  return response.json();
};

// ---------------------------------------------------------------------------
// Request Handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const action = parseAction(method);

  try {
    switch (action) {
      case 'api': {
        const endpoint = params?.endpoint as string | undefined;
        if (!endpoint) {
          return fail(id, INVALID_PARAMS, 'Missing required parameter: endpoint');
        }

        const httpMethod = (params?.method as string) ?? 'GET';
        const body = params?.body as Record<string, unknown> | undefined;
        const headers = params?.headers as Record<string, string> | undefined;

        const auth = getAuth();
        if (!auth) {
          return fail(id, NOT_AUTHENTICATED, 'Not authenticated. Please sign in and try again.');
        }

        const data = await callApi(endpoint, httpMethod, body, headers);
        return ok(id, data);
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action ?? '(empty)'}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration — Makes this adapter available to the platform
// ---------------------------------------------------------------------------

registerAdapter('{{pluginName}}', handleRequest);

export {};
