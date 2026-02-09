/**
 * Retool Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies and CSRF tokens.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api           — Retool API (GET/POST/PUT/DELETE with CSRF token)
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const extractXsrfToken = (): string | null => {
  try {
    const match = document.cookie.match(/(?:^|;\s*)xsrfToken=([^;]*)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // Ignore extraction errors
  }
  return null;
};

// ---------------------------------------------------------------------------
// API transport
// ---------------------------------------------------------------------------

const callApi = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<unknown> => {
  const baseUrl = window.location.origin;
  const xsrfToken = extractXsrfToken();

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

  if (xsrfToken) {
    headers['x-xsrf-token'] = xsrfToken;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Retool API error ${response.status}: ${errorText}`);
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

        const httpMethod = (params?.method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'GET';
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

registerAdapter('retool', handleRequest);

export {};
