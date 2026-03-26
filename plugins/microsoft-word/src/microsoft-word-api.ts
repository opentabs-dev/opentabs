import {
  ToolError,
  buildQueryString,
  clearAuthCache,
  findLocalStorageEntry,
  getAuthCache,
  getLocalStorage,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Microsoft 365 consumer app MSAL client ID
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';

interface MsWordAuth {
  token: string;
}

/**
 * Extract the Microsoft Graph API access token from MSAL localStorage cache.
 * MSAL stores tokens with keys containing the client ID, account ID, and scope.
 * The Graph API token has 'graph.microsoft.com' in its scope key.
 */
const getAuth = (): MsWordAuth | null => {
  const cached = getAuthCache<MsWordAuth>('microsoft-word');
  if (cached) return cached;

  // Find the token keys entry for the MSAL client ID
  const tokenKeysRaw = getLocalStorage(`msal.token.keys.${MSAL_CLIENT_ID}`);
  if (!tokenKeysRaw) {
    // Try finding any MSAL token keys entry dynamically
    const entry = findLocalStorageEntry(key => key.startsWith('msal.token.keys.'));
    if (!entry) return null;
  }

  const keysSource = tokenKeysRaw ?? findLocalStorageEntry(key => key.startsWith('msal.token.keys.'))?.value;
  if (!keysSource) return null;

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(keysSource);
  } catch {
    return null;
  }

  if (!tokenKeys.accessToken) return null;

  // Find the Graph API access token (scope contains graph.microsoft.com)
  for (const key of tokenKeys.accessToken) {
    if (!/(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key)) continue;
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.secret) continue;

      // Check expiration — MSAL stores expiresOn as epoch seconds string
      const expiresOn = Number.parseInt(parsed.expiresOn, 10);
      if (expiresOn && expiresOn * 1000 < Date.now()) continue;

      const auth: MsWordAuth = { token: parsed.secret };
      setAuthCache('microsoft-word', auth);
      return auth;
    } catch {
      // skip invalid token entries
    }
  }

  return null;
};

/**
 * Get the raw Graph API access token.
 * Used by tools that need raw fetch (non-JSON body uploads).
 */
export const getGraphToken = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');
  return auth.token;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Make an authenticated request to the Microsoft Graph API.
 * Handles JSON responses, error classification, and token invalidation.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${GRAPH_API_BASE}${endpoint}?${qs}` : `${GRAPH_API_BASE}${endpoint}`;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  const init: FetchFromPageOptions = { method, headers };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Microsoft Graph API request timed out.');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ToolError('Request aborted', 'aborted');
    }
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (response.status === 204) return {} as T;

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Microsoft Graph API rate limit exceeded.', retryMs);
  }

  if (response.status === 401 || response.status === 403) {
    clearAuthCache('microsoft-word');
    throw ToolError.auth('Authentication expired — please refresh the page.');
  }

  if (response.status === 404) {
    throw ToolError.notFound('The requested resource was not found.');
  }

  if (!response.ok) {
    let errorMsg = `Microsoft Graph API error (${response.status})`;
    try {
      const errBody = (await response.json()) as {
        error?: { message?: string; code?: string };
      };
      if (errBody.error?.message) {
        errorMsg = errBody.error.message;
      }
    } catch {
      // ignore parse errors
    }
    if (response.status === 400 || response.status === 422) {
      throw ToolError.validation(errorMsg);
    }
    throw ToolError.internal(errorMsg);
  }

  return (await response.json()) as T;
};
