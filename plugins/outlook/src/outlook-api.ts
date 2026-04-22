import { config as zodConfig } from 'zod';
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

// Outlook on cloud.microsoft enforces Trusted Types, which blocks zod's JIT
// eval probe (`new Function("")`). Disabling JIT here — before any z.object()
// schema is instantiated — prevents the CSP violation entirely.
if (typeof window !== 'undefined' && 'trustedTypes' in window) {
  zodConfig({ jitless: true });
}

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_CLOUD_BASE = 'https://outlook.cloud.microsoft/ows/v1.0';
const OUTLOOK_REST_BASE = 'https://outlook.office.com/api/v2.0';

// Outlook enterprise MSAL client ID
const MSAL_CLIENT_ID = '9199bf20-a13f-4107-85dc-02114787ef48';
// Consumer fallback
const MSAL_CLIENT_ID_CONSUMER = '2821b473-fe24-4c86-ba16-62834d6e80c3';

// Token captured by intercepting Outlook's own fetch calls (used when MSAL
// tokens are encrypted at rest by the Protected Token Cache on cloud.microsoft).
let interceptedToken: OutlookAuth | null = null;

/**
 * Search window globals for an MSAL PublicClientApplication instance and acquire
 * a token silently. MSAL keeps decrypted tokens in memory even when localStorage
 * entries are encrypted (ProtectedTokenCache). This works regardless of injection timing.
 */
const tryAcquireMsalToken = async (): Promise<OutlookAuth | null> => {
  try {
    const scopes = [
      ['https://graph.microsoft.com/Mail.Read'],
      ['https://graph.microsoft.com/Mail.ReadWrite'],
      ['https://outlook.office.com/Mail.Read'],
      ['https://outlook.office.com/Mail.ReadWrite'],
    ];

    // Search window for MSAL-like objects (PublicClientApplication has acquireTokenSilent + getAllAccounts)
    const candidates: unknown[] = [];
    for (const key of Object.keys(window)) {
      try {
        const val = (window as unknown as Record<string, unknown>)[key];
        if (val && typeof val === 'object' && typeof (val as Record<string, unknown>).acquireTokenSilent === 'function' && typeof (val as Record<string, unknown>).getAllAccounts === 'function') {
          candidates.push(val);
        }
      } catch { /* skip non-enumerable */ }
    }

    for (const msal of candidates) {
      const app = msal as { getAllAccounts: () => unknown[]; acquireTokenSilent: (req: unknown) => Promise<{ accessToken: string } | undefined> };
      const accounts = app.getAllAccounts();
      if (!accounts.length) continue;
      for (const scopeSet of scopes) {
        try {
          const result = await app.acquireTokenSilent({ scopes: scopeSet, account: accounts[0] });
          if (result?.accessToken) {
            const apiBase = (scopeSet[0] ?? '').includes('graph.microsoft.com') ? GRAPH_API_BASE : OUTLOOK_REST_BASE;
            console.warn('[opentabs-outlook] Acquired token via MSAL acquireTokenSilent, apiBase:', apiBase);
            return { token: result.accessToken, apiBase };
          }
        } catch { /* try next scope set */ }
      }
    }
  } catch { /* ignore */ }
  return null;
};

const decodeJwt = (token: string): Record<string, unknown> => {
  try {
    const part = token.split('.')[1] ?? '';
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch { return {}; }
};

const jwtScopes = (token: string): string => {
  const p = decodeJwt(token);
  return ((p['scp'] ?? p['scope'] ?? '') as string);
};

const jwtAud = (token: string): string => {
  return ((decodeJwt(token)['aud'] ?? '') as string);
};

const captureToken = (url: string, authHeader: string): void => {
  if (interceptedToken) return;
  if (!authHeader.startsWith('Bearer ')) return;
  const isGraph = url.includes('graph.microsoft.com');
  const isOutlookCloud = url.includes('outlook.cloud.microsoft') || url.startsWith('/owa/');
  const isOutlookOffice = url.includes('outlook.office.com');
  if (!isGraph && !isOutlookCloud && !isOutlookOffice) return;
  const token = authHeader.slice(7);
  // Skip Graph tokens that lack mail scopes — they cause 403 on mail endpoints.
  if (isGraph && !hasMailScope(jwtScopes(token))) return;
  const aud = jwtAud(token);
  const apiBase = isGraph
    ? GRAPH_API_BASE
    : aud.includes('outlook.office.com')
      ? OUTLOOK_REST_BASE
      : OUTLOOK_CLOUD_BASE;
  interceptedToken = { token, apiBase };
  setAuthCache('outlook', interceptedToken);
  console.warn('[opentabs-outlook] Captured Bearer token via interceptor, apiBase:', apiBase);
};

/**
 * Intercept both window.fetch and XMLHttpRequest to capture Bearer tokens from
 * Outlook's own API calls. Outlook may capture window.fetch before our adapter
 * is injected, so XHR interception is the reliable fallback.
 */
const installFetchInterceptor = (): void => {
  // fetch interceptor — catches calls made after our injection
  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      try {
        const url = input instanceof Request ? input.url : String(input);
        const hdrs = init?.headers ?? (input instanceof Request ? input.headers : undefined);
        let authHeader: string | null = null;
        if (hdrs instanceof Headers) authHeader = hdrs.get('Authorization');
        else if (hdrs && typeof hdrs === 'object') authHeader = (hdrs as Record<string, string>)['Authorization'] ?? null;
        if (authHeader) captureToken(url, authHeader);
      } catch { /* never block real fetch */ }
      return originalFetch(input, init);
    };
  } catch { /* ignore */ }

  // XHR prototype patch — intercepts ALL XHR instances regardless of when the
  // constructor reference was captured, because all instances share the same prototype.
  try {
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;

    proto.open = function (this: XMLHttpRequest & { _otUrl?: string }, method: string, url: string, ...rest: unknown[]) {
      this._otUrl = url;
      return (originalOpen as Function).apply(this, [method, url, ...rest]);
    };

    proto.setRequestHeader = function (this: XMLHttpRequest & { _otUrl?: string }, name: string, value: string) {
      try {
        if (name.toLowerCase() === 'authorization' && this._otUrl) captureToken(this._otUrl, value);
      } catch { /* ignore */ }
      return originalSetRequestHeader.call(this, name, value);
    };
  } catch { /* ignore */ }
};

if (typeof window !== 'undefined') {
  installFetchInterceptor();
  // Proactively acquire token via MSAL in-memory cache so it's ready before the first tool call.
  tryAcquireMsalToken().then(auth => {
    if (auth && !interceptedToken) {
      interceptedToken = auth;
      setAuthCache('outlook', auth);
    }
  }).catch(() => { /* ignore */ });
}

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
 * Search the newer MSAL "partitioned" cache format used by cloud.microsoft.
 * Keys follow the pattern: msal.2|{accountId}|{authority}|accesstoken|{clientId}|{tenantId}|{scopes}||
 * Unlike the old format, there is no separate token-keys index — each token is stored directly.
 */
const findMsalPartitionedToken = (clientId: string, scopeMatch: string): OutlookAuth | null => {
  const clientIdSegment = `|accesstoken|${clientId}|`;

  const result = findLocalStorageEntry(key => {
    if (!key.startsWith('msal.2|')) return false;
    if (!key.includes(clientIdSegment)) return false;
    return key.toLowerCase().includes(scopeMatch);
  });

  if (!result) return null;

  try {
    const parsed = JSON.parse(result.value);
    if (!parsed.secret) return null;

    const expiresOn = Number.parseInt(parsed.expiresOn ?? parsed.extended_expires_on, 10);
    if (expiresOn && expiresOn * 1000 < Date.now()) return null;

    const target: string = parsed.target ?? '';
    if (scopeMatch === 'graph.microsoft.com' && !hasMailScope(target)) return null;

    const apiBase = scopeMatch === 'graph.microsoft.com' ? GRAPH_API_BASE : OUTLOOK_REST_BASE;
    return { token: parsed.secret, apiBase };
  } catch {
    return null;
  }
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

      const apiBase = scopeMatch === 'graph.microsoft.com' ? GRAPH_API_BASE : OUTLOOK_REST_BASE;
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

  // Check token captured by the document_start content script (token-interceptor.js),
  // which patches fetch/XHR before Outlook's code runs.
  const earlyCapture = (window as unknown as { __opentabs_auth?: OutlookAuth }).__opentabs_auth;
  if (earlyCapture) {
    setAuthCache('outlook', earlyCapture);
    return earlyCapture;
  }

  if (interceptedToken) return interceptedToken;
  console.warn('[opentabs-outlook] getAuth() searching localStorage, total keys:', localStorage.length);

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

  // 6. Newer MSAL partitioned format (cloud.microsoft): keys are msal.2|{account}|...|accesstoken|{clientId}|...
  if (!auth) auth = findMsalPartitionedToken(MSAL_CLIENT_ID, 'outlook.office.com');
  if (!auth) auth = findMsalPartitionedToken(MSAL_CLIENT_ID, 'graph.microsoft.com');
  if (!auth) auth = findMsalPartitionedToken(MSAL_CLIENT_ID_CONSUMER, 'outlook.office.com');
  if (!auth) auth = findMsalPartitionedToken(MSAL_CLIENT_ID_CONSUMER, 'graph.microsoft.com');

  if (!auth) {
    // Diagnostic: log all localStorage keys containing 'msal' to understand token format
    const msalKeys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.toLowerCase().includes('msal')) msalKeys.push(k);
      }
    } catch { /* ignore */ }
    console.warn('[opentabs-outlook] No MSAL token found. MSAL-related localStorage keys:', msalKeys);
  } else {
    console.warn('[opentabs-outlook] MSAL token found, apiBase:', auth.apiBase);
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
const toPascalCase = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

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
 * Recursively convert camelCase keys to PascalCase for Outlook REST API request bodies.
 * Outlook REST API v2.0 expects PascalCase keys (Subject, Body, ToRecipients, etc.).
 */
const normalizeKeysForRequest = (obj: unknown): unknown => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeysForRequest);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newKey = key.startsWith('@') ? key : toPascalCase(key);
    result[newKey] = normalizeKeysForRequest(value);
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
  const isOutlookApi = auth.apiBase === OUTLOOK_REST_BASE;

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
    // Outlook REST API v2.0 expects PascalCase keys in request bodies.
    const bodyToSend = isOutlookApi ? normalizeKeysForRequest(options.body) : options.body;
    init.body = JSON.stringify(bodyToSend);
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
  if (!auth) {
    // localStorage tokens are encrypted — try MSAL in-memory acquireTokenSilent
    const msalAuth = await tryAcquireMsalToken();
    if (msalAuth) {
      interceptedToken = msalAuth;
      setAuthCache('outlook', msalAuth);
      auth = msalAuth;
    }
  }
  if (!auth) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');

  const result = await sendRequest<T>(auth, endpoint, options);
  if (result !== null) return result;

  // 401/403 — clear stale cache, re-acquire token from MSAL, and retry once
  clearAuthCache('outlook');
  interceptedToken = null;
  auth = getAuth() ?? (await tryAcquireMsalToken());
  if (auth) { interceptedToken = auth; setAuthCache('outlook', auth); }
  if (!auth) throw ToolError.auth('Authentication expired — please refresh the Outlook page.');

  const retry = await sendRequest<T>(auth, endpoint, options);
  if (retry !== null) return retry;

  clearAuthCache('outlook');
  throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
};
