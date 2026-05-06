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
const OUTLOOK_API_BASE = 'https://outlook.office.com/api/v2.0';

// Outlook enterprise MSAL client ID
const MSAL_CLIENT_ID = '9199bf20-a13f-4107-85dc-02114787ef48';
// Consumer fallback
const MSAL_CLIENT_ID_CONSUMER = '2821b473-fe24-4c86-ba16-62834d6e80c3';

interface OutlookAuth {
  token: string;
  apiBase: string; // which API base URL this token works with
}

/**
 * Scopes required for mail operations. A token must include at least one of these
 * to be usable for reading/sending mail.
 */
const MAIL_SCOPES = ['mail.read', 'mail.readwrite', 'mail.send'];

/**
 * Check whether a token's target scopes include at least one mail-related scope.
 */
const hasMailScope = (target: string): boolean => {
  const lower = target.toLowerCase();
  return MAIL_SCOPES.some(scope => lower.includes(scope));
};

/**
 * Search MSAL v2 token cache for a valid access token matching a target scope pattern.
 * When matching Graph API tokens, also verifies the token has mail scopes — some
 * enterprise tenants issue Graph tokens with User.Read but without Mail.Read, which
 * causes 403 errors on /me/messages endpoints.
 */
const findMsalV2Token = (clientId: string, scopeMatch: string): OutlookAuth | null => {
  const tokenKeysRaw = getLocalStorage(`msal.2.token.keys.${clientId}`);
  if (!tokenKeysRaw) return null;

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(tokenKeysRaw);
  } catch {
    return null;
  }
  if (!tokenKeys.accessToken) return null;

  for (const key of tokenKeys.accessToken) {
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.secret) continue;

      const target: string = parsed.target ?? '';
      const matches = target.toLowerCase().includes(scopeMatch) || key.toLowerCase().includes(scopeMatch);
      if (!matches) continue;

      const expiresOn = Number.parseInt(parsed.expiresOn, 10);
      if (expiresOn && expiresOn * 1000 < Date.now()) continue;

      // For Graph API tokens, verify mail scopes are present.
      // Enterprise tenants may have a Graph token with only User.Read that will
      // 403 on mail endpoints. Skip it so we fall through to the Outlook REST token.
      if (scopeMatch === 'graph.microsoft.com' && !hasMailScope(target)) {
        continue;
      }

      const apiBase = scopeMatch === 'graph.microsoft.com' ? GRAPH_API_BASE : OUTLOOK_API_BASE;
      return { token: parsed.secret, apiBase };
    } catch {
      // skip invalid entries
    }
  }
  return null;
};

/**
 * Search MSAL v1 token cache for a valid Graph API access token.
 */
const findMsalV1Token = (clientId: string): OutlookAuth | null => {
  const tokenKeysRaw = getLocalStorage(`msal.token.keys.${clientId}`);
  if (!tokenKeysRaw) return null;

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(tokenKeysRaw);
  } catch {
    return null;
  }
  if (!tokenKeys.accessToken) return null;

  for (const key of tokenKeys.accessToken) {
    if (!/(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key)) continue;
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.secret) continue;
      const expiresOn = Number.parseInt(parsed.expiresOn, 10);
      if (expiresOn && expiresOn * 1000 < Date.now()) continue;
      return { token: parsed.secret, apiBase: GRAPH_API_BASE };
    } catch {
      // skip invalid entries
    }
  }
  return null;
};

/**
 * Extract a valid access token from MSAL localStorage cache.
 * Priority: Graph API token > Outlook REST API token.
 * Supports MSAL v2 (enterprise) and v1 (consumer) formats.
 */
const getAuth = (): OutlookAuth | null => {
  const cached = getAuthCache<OutlookAuth>('outlook');
  if (cached) return cached;

  // 1. Enterprise MSAL v2 — Graph API token
  let auth = findMsalV2Token(MSAL_CLIENT_ID, 'graph.microsoft.com');

  // 2. Enterprise MSAL v2 — Outlook REST API token (has mail.readwrite scopes)
  if (!auth) auth = findMsalV2Token(MSAL_CLIENT_ID, 'outlook.office.com');

  // 3. Consumer MSAL v1 — Graph API token
  if (!auth) auth = findMsalV1Token(MSAL_CLIENT_ID_CONSUMER);

  // 4. Fallback: scan for any MSAL v2 entry with Graph scope
  if (!auth) {
    const entry = findLocalStorageEntry(key => key.startsWith('msal.2.token.keys.'));
    if (entry) {
      const cid = entry.key.replace('msal.2.token.keys.', '');
      auth = findMsalV2Token(cid, 'graph.microsoft.com');
      if (!auth) auth = findMsalV2Token(cid, 'outlook.office.com');
    }
  }

  // 5. Fallback: scan for any MSAL v1 entry
  if (!auth) {
    const entry = findLocalStorageEntry(key => key.startsWith('msal.token.keys.'));
    if (entry) {
      const cid = entry.key.replace('msal.token.keys.', '');
      auth = findMsalV1Token(cid);
    }
  }

  if (auth) setAuthCache('outlook', auth);
  return auth;
};

export const isAuthenticated = (): boolean => {
  // During OAuth redirect the #code= fragment is present but MSAL tokens are
  // not yet in localStorage. Return false early so the platform's 30s re-poll
  // catches the token once the handshake completes, rather than burning the
  // 5s isReady window on token searches that will all fail.
  if (typeof window !== 'undefined' && window.location.hash.includes('code=')) return false;
  return getAuth() !== null;
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Recursively convert PascalCase keys to camelCase.
 * Outlook REST API returns PascalCase; Graph returns camelCase.
 * Normalizing to camelCase lets all mappers work with both APIs.
 */
const toCamelCase = (str: string): string => str.charAt(0).toLowerCase() + str.slice(1);

const normalizeKeys = (obj: unknown): unknown => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip OData metadata keys like @odata.context
    const newKey = key.startsWith('@') ? key : toCamelCase(key);
    result[newKey] = normalizeKeys(value);
  }
  return result;
};

/**
 * Send an authenticated request and handle the response.
 * Returns the parsed response or throws on error.
 * On 401/403, returns `null` to signal the caller to retry with a fresh token.
 */
const sendRequest = async <T>(
  auth: OutlookAuth,
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  },
): Promise<T | null> => {
  const isOutlookApi = auth.apiBase === OUTLOOK_API_BASE;

  // Outlook REST API uses different $select field names, so drop $select
  // and let it return all fields. The normalizeKeys step handles casing.
  const query = options.query ? { ...options.query } : undefined;
  if (isOutlookApi && query) {
    delete (query as Record<string, unknown>).$select;
  }

  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${auth.apiBase}${endpoint}?${qs}` : `${auth.apiBase}${endpoint}`;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    ...options.headers,
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
      throw ToolError.timeout('Microsoft API request timed out.');
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
    throw ToolError.rateLimited('Microsoft API rate limit exceeded.', retryMs);
  }

  // Signal caller to retry with a fresh token
  if (response.status === 401 || response.status === 403) return null;

  if (response.status === 404) {
    throw ToolError.notFound('The requested resource was not found.');
  }

  if (!response.ok) {
    let errorMsg = `Microsoft API error (${response.status})`;
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

  const json = await response.json();
  return (isOutlookApi ? normalizeKeys(json) : json) as T;
};

/**
 * Make an authenticated request to Microsoft mail APIs.
 * Automatically uses whichever API the current token supports (Graph or Outlook REST).
 * On 401/403, clears the cached token, re-acquires from MSAL localStorage, and retries once.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  } = {},
): Promise<T> => {
  let auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');

  const result = await sendRequest<T>(auth, endpoint, options);
  if (result !== null) return result;

  // 401/403 — clear stale cache, re-acquire token from MSAL, and retry once
  clearAuthCache('outlook');
  auth = getAuth();
  if (!auth) throw ToolError.auth('Authentication expired — please refresh the Outlook page.');

  const retry = await sendRequest<T>(auth, endpoint, options);
  if (retry !== null) return retry;

  clearAuthCache('outlook');
  throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
};
