import { ToolError, buildQueryString, fetchJSON, getCookie, waitUntil } from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

/** Extract XSRF token from the `xsrfToken` cookie. */
const getXsrfToken = (): string | null => getCookie('xsrfToken');

/** Retool uses HttpOnly session cookies. Auth is detected by the xsrfToken cookie. */
export const isAuthenticated = (): boolean => getXsrfToken() !== null;

/** Poll for authentication readiness (SPA hydration). */
export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Generic API caller for Retool's internal cookie-based API.
 * Uses relative paths — works on both retool.com and self-hosted instances
 * because the adapter runs in the matching tab's page context.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const xsrf = getXsrfToken();
  if (!xsrf) throw ToolError.auth('Not authenticated — please log in to Retool.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${endpoint}?${qs}` : endpoint;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Xsrf-Token': xsrf,
  };

  const init: FetchFromPageOptions = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  return fetchJSON<T>(url, init) as Promise<T>;
};
