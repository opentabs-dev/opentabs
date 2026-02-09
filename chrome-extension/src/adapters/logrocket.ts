/**
 * LogRocket Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies and localStorage.
 *
 * LogRocket's REST API is hosted at api.logrocket.com/v1 (cross-origin from
 * app.logrocket.com). Authentication uses a Bearer token stored in localStorage
 * under key "v6" → auth.authToken. The API URL is read from the page's
 * __LRCONFIG__.apiURL for resilience.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api           — LogRocket REST API (GET/POST/PATCH/DELETE with Bearer token)
 * - graphql       — LogRocket GraphQL API (same-origin at /v1/graphql)
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const getAuthToken = (): string | null => {
  try {
    const raw = localStorage.getItem('v6');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { auth?: { authToken?: string } };
    return parsed?.auth?.authToken ?? null;
  } catch {
    return null;
  }
};

const getApiBaseUrl = (): string => {
  try {
    const config = (window as unknown as { __LRCONFIG__?: { apiURL?: string } }).__LRCONFIG__;
    if (config?.apiURL) return config.apiURL;
  } catch {
    // fall through
  }
  return 'https://api.logrocket.com/v1';
};

// ---------------------------------------------------------------------------
// REST API transport
// ---------------------------------------------------------------------------

const callApi = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<unknown> => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated to LogRocket. Please log in at app.logrocket.com.');

  const baseUrl = getApiBaseUrl();

  // Build URL with query params
  let url = `${baseUrl}${endpoint}`;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    url += (url.includes('?') ? '&' : '?') + searchParams.toString();
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if ((method === 'POST' || method === 'PATCH') && body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LogRocket API error ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  if (!text) {
    return { success: true };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { data: text };
  }
};

// ---------------------------------------------------------------------------
// GraphQL transport (same-origin at app.logrocket.com/v1/graphql)
// ---------------------------------------------------------------------------

const callGraphql = async (query: string, variables?: Record<string, unknown>): Promise<unknown> => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated to LogRocket. Please log in at app.logrocket.com.');

  const response = await fetch(`${window.location.origin}/v1/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LogRocket GraphQL error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (data.errors?.length) {
    throw new Error(`GraphQL error: ${data.errors.map((e: { message: string }) => e.message).join('; ')}`);
  }

  return data.data;
};

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const [, action] = method.split('.');

  try {
    switch (action) {
      case 'api': {
        const endpoint = params?.endpoint as string;
        if (!endpoint) return fail(id, INVALID_PARAMS, 'Missing required parameter: endpoint');

        const httpMethod = (params?.method as 'GET' | 'POST' | 'PATCH' | 'DELETE') || 'GET';
        const queryParams = params?.params as Record<string, unknown> | undefined;
        const body = params?.body;
        const data = await callApi(endpoint, httpMethod, queryParams, body);
        return ok(id, data);
      }

      case 'graphql': {
        const query = params?.query as string;
        if (!query) return fail(id, INVALID_PARAMS, 'Missing required parameter: query');

        const variables = params?.variables as Record<string, unknown> | undefined;
        const data = await callGraphql(query, variables);
        return ok(id, data);
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerAdapter('logrocket', handleRequest);

export {};
