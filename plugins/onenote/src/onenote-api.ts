import {
  ToolError,
  findLocalStorageEntry,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  parseRetryAfterMs,
  waitUntil,
  buildQueryString,
} from '@opentabs-dev/plugin-sdk';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// MSAL client ID used by the OneNote web app
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';

interface OneNoteAuth {
  token: string;
  expiresOn: number;
}

/**
 * Extracts the Microsoft Graph access token from MSAL localStorage entries.
 * The OneNote web app stores MSAL tokens in localStorage with keys containing
 * "accesstoken" and the target resource URL.
 */
const extractMsalToken = (): string | null => {
  // Find the token keys entry for this MSAL client
  const tokenKeysEntry = findLocalStorageEntry(key => key === `msal.token.keys.${MSAL_CLIENT_ID}`);
  if (!tokenKeysEntry) return null;

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(tokenKeysEntry.value);
  } catch {
    return null;
  }

  // Look for a Graph API access token
  const graphKey = tokenKeys.accessToken?.find(
    k => /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(k) || k.includes('notes.create'),
  );
  if (!graphKey) return null;

  const entryStr = findLocalStorageEntry(key => key === graphKey);
  if (!entryStr) return null;

  let entry: { secret?: string; expiresOn?: string };
  try {
    entry = JSON.parse(entryStr.value);
  } catch {
    return null;
  }

  if (!entry.secret) return null;

  // Check expiration
  const expiresOn = Number(entry.expiresOn ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresOn > 0 && expiresOn < nowSeconds) return null;

  return entry.secret;
};

const getAuth = (): OneNoteAuth | null => {
  const cached = getAuthCache<OneNoteAuth>('onenote');
  if (cached && cached.expiresOn > Math.floor(Date.now() / 1000)) return cached;

  // Check token captured by the document_start content script interceptor —
  // works even when MSAL tokens are encrypted at rest (Protected Token Cache).
  const earlyCapture = (window as unknown as { __opentabs_auth?: { token: string } }).__opentabs_auth;
  if (earlyCapture?.token) {
    const auth: OneNoteAuth = {
      token: earlyCapture.token,
      expiresOn: Math.floor(Date.now() / 1000) + 3600,
    };
    setAuthCache('onenote', auth);
    return auth;
  }

  const token = extractMsalToken();
  if (!token) return null;

  const auth: OneNoteAuth = {
    token,
    expiresOn: Math.floor(Date.now() / 1000) + 3600,
  };
  setAuthCache('onenote', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Calls the Microsoft Graph API for OneNote operations.
 * Auth is via MSAL bearer tokens extracted from localStorage.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | string;
    query?: Record<string, string | number | boolean | undefined>;
    contentType?: string;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) {
    clearAuthCache('onenote');
    throw ToolError.auth('Not authenticated — please log in to Microsoft OneNote.');
  }

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  let fetchBody: string | undefined;
  if (options.body) {
    if (typeof options.body === 'string') {
      headers['Content-Type'] = options.contentType ?? 'text/html';
      fetchBody = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(options.body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: fetchBody,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403) {
      clearAuthCache('onenote');
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 400 || response.status === 422)
      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
