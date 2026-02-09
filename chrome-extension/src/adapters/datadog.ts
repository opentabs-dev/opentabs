/**
 * Datadog Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies and localStorage.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api           — Datadog API (GET/POST/DELETE with CSRF token)
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const extractCsrfToken = (): string | null => {
  try {
    const stored = localStorage.getItem('dd-csrf-token');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.token ?? null;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

// ---------------------------------------------------------------------------
// API transport
// ---------------------------------------------------------------------------

const callApi = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE',
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<unknown> => {
  const baseUrl = window.location.origin;
  const token = extractCsrfToken();

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
  };

  if (token) {
    headers['x-csrf-token'] = token;
    headers['x-dd-csrf-token'] = token;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if ((method === 'POST' || method === 'DELETE') && body) {
    let requestBody = body;
    if (typeof body === 'object' && body !== null && !Array.isArray(body) && token) {
      requestBody = { ...body, _authentication_token: token };
    }
    fetchOptions.body = JSON.stringify(requestBody);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Datadog API error ${response.status}: ${errorText}`);
  }

  return response.json();
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

        const httpMethod = (params?.method as 'GET' | 'POST' | 'DELETE') || 'GET';
        const queryParams = params?.params as Record<string, unknown> | undefined;
        const body = params?.body;
        const data = await callApi(endpoint, httpMethod, queryParams, body);
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

registerAdapter('datadog', handleRequest);

export {};
