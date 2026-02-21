// ---------------------------------------------------------------------------
// Fetch utilities for plugin authors
// ---------------------------------------------------------------------------

import { ToolError } from './errors.js';

export interface FetchFromPageOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Fetches a URL using the page's authenticated session (credentials: 'include').
 * Provides built-in timeout via AbortSignal and throws a descriptive ToolError
 * on non-ok HTTP status codes.
 */
export const fetchFromPage = async (url: string, init?: FetchFromPageOptions): Promise<Response> => {
  const { timeout = 30_000, signal, ...rest } = init ?? {};

  const timeoutSignal = AbortSignal.timeout(timeout);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...rest,
      signal: combinedSignal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ToolError(`fetchFromPage: request timed out after ${timeout}ms for ${url}`, 'timeout');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ToolError(`fetchFromPage: request aborted for ${url}`, 'aborted');
    }
    throw new ToolError(
      `fetchFromPage: network error for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      'network_error',
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new ToolError(`fetchFromPage: HTTP ${response.status} for ${url}: ${errorText}`, 'http_error');
  }

  return response;
};

/**
 * Fetches a URL and parses the response as JSON. Uses the page's session
 * cookies (credentials: 'include') and provides timeout + error handling.
 */
export const fetchJSON = async <T>(url: string, init?: FetchFromPageOptions): Promise<T> => {
  const response = await fetchFromPage(url, init);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ToolError(`fetchJSON: failed to parse JSON response from ${url}`, 'json_parse_error');
  }
};

/**
 * Convenience wrapper for POST requests with a JSON body. Sets Content-Type,
 * stringifies the body, and parses the JSON response.
 */
export const postJSON = async <T>(url: string, body: unknown, init?: FetchFromPageOptions): Promise<T> => {
  const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
  return fetchJSON<T>(url, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
};
