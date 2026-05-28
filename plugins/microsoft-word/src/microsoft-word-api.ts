import {
  ToolError,
  buildQueryString,
  findLocalStorageEntry,
  getCurrentUrl,
  getLocalStorage,
  getPreScriptValue,
  parseRetryAfterMs,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

// Microsoft 365 consumer app MSAL client ID
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';
/** localStorage key the pre-script mirrors the captured Graph token to. */
const LS_TOKEN_KEY = '__opentabs_word_graph_token';

interface CapturedGraphToken {
  token: string;
  /** Unix epoch seconds. */
  exp: number;
}

/**
 * Read a value the pre-script stashed under the `microsoft-word` namespace.
 *
 * `getPreScriptValue` depends on `globalThis.__openTabs._pluginName`, which the
 * adapter only binds during tool dispatch — so it returns `undefined` in
 * `isReady()`, which runs earlier. We try the SDK helper first (forward-compat),
 * then fall back to a direct read against the documented namespace path.
 */
const readPreScriptValue = <T>(key: string): T | undefined => {
  const viaSdk = getPreScriptValue<T>(key);
  if (viaSdk !== undefined) return viaSdk;
  const ns = (globalThis as { __openTabs?: { preScript?: Record<string, Record<string, unknown>> } }).__openTabs
    ?.preScript?.['microsoft-word'];
  return ns?.[key] as T | undefined;
};

/** A captured token is usable if it has a non-empty value and is not about to expire. */
const usableToken = (captured: CapturedGraphToken | undefined | null): string | null => {
  if (!captured || typeof captured.token !== 'string' || captured.token.length === 0) return null;
  if (typeof captured.exp !== 'number' || captured.exp <= Math.floor(Date.now() / 1000) + 30) return null;
  return captured.token;
};

/**
 * The Graph token captured by the pre-script (the path that works on
 * SharePoint/OneDrive-hosted documents, where MSAL's cache is encrypted).
 * Checked in the in-page namespace first, then the localStorage mirror.
 */
const getCapturedToken = (): string | null => {
  const fromNamespace = usableToken(readPreScriptValue<CapturedGraphToken>('graph'));
  if (fromNamespace) return fromNamespace;
  try {
    const raw = getLocalStorage(LS_TOKEN_KEY);
    if (raw) return usableToken(JSON.parse(raw) as CapturedGraphToken);
  } catch {
    /* malformed or inaccessible — fall through */
  }
  return null;
};

/**
 * A plaintext Graph access token from the standalone `word.cloud.microsoft`
 * app's MSAL localStorage cache, keyed by client id and scope.
 */
const getMsalToken = (): string | null => {
  const tokenKeysRaw = getLocalStorage(`msal.token.keys.${MSAL_CLIENT_ID}`);
  const keysSource = tokenKeysRaw ?? findLocalStorageEntry(key => key.startsWith('msal.token.keys.'))?.value;
  if (!keysSource) return null;

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(keysSource);
  } catch {
    return null;
  }
  if (!tokenKeys.accessToken) return null;

  for (const key of tokenKeys.accessToken) {
    if (!/(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key)) continue;
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) continue;
      // MSAL stores `expiresOn` as a unix-epoch-seconds string. A missing or
      // unparseable value means we cannot prove the token is live — treat it as
      // expired rather than risk returning a stale token.
      const expiresOn = Number.parseInt(String(parsed.expiresOn ?? '0'), 10);
      if (!(expiresOn > Math.floor(Date.now() / 1000))) continue;
      return parsed.secret;
    } catch {
      // skip invalid token entries
    }
  }
  return null;
};

const getToken = (): string | null => getCapturedToken() ?? getMsalToken();

/**
 * Get the raw Graph API access token.
 * Used by tools that need raw fetch (non-JSON body uploads).
 */
export const getGraphToken = (): string => {
  const token = getToken();
  if (!token) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');
  return token;
};

export const isAuthenticated = (): boolean => getToken() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );

/** True when the current tab is a SharePoint/OneDrive-hosted Word document. */
export const isSharePointDocument = (): boolean => {
  try {
    const url = new URL(getCurrentUrl());
    return url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:w:/');
  } catch {
    return false;
  }
};

interface DocumentContext {
  driveId: string;
  itemId: string;
}

/** Per-tab cache — the open document does not change within a page session. */
let cachedContext: DocumentContext | null = null;

/** Encode a sharing URL into a Graph `/shares` share id (unpadded base64url with a `u!` prefix). */
const encodeShareId = (sharingUrl: string): string => {
  const base64 = btoa(unescape(encodeURIComponent(sharingUrl)));
  return `u!${base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

/**
 * Resolve the open document's drive and item ids.
 *
 * The standalone `word.cloud.microsoft` app carries `driveId`/`docId` in the URL
 * query. SharePoint/OneDrive-hosted documents identify the file by a sharing
 * token in the path, resolved to `{driveId, itemId}` via Graph `/shares`.
 * Returns null when no document context is available (e.g. a file-browser page).
 */
export const resolveDocumentContext = async (): Promise<DocumentContext | null> => {
  if (cachedContext) return cachedContext;
  const url = new URL(getCurrentUrl());
  const driveId = url.searchParams.get('driveId');
  const docId = url.searchParams.get('docId');
  if (driveId && docId) {
    cachedContext = { driveId, itemId: docId };
    return cachedContext;
  }
  if (url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:w:/')) {
    const item = await api<{ id?: string; parentReference?: { driveId?: string } }>(
      `/shares/${encodeShareId(url.href)}/driveItem`,
      { query: { $select: 'id,parentReference' } },
    );
    const resolvedDriveId = item.parentReference?.driveId;
    if (resolvedDriveId && item.id) {
      cachedContext = { driveId: resolvedDriveId, itemId: item.id };
      return cachedContext;
    }
  }
  return null;
};

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
  const token = getToken();
  if (!token) throw ToolError.auth('Not authenticated — please sign in to Microsoft 365.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${GRAPH_API_BASE}${endpoint}?${qs}` : `${GRAPH_API_BASE}${endpoint}`;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const init: RequestInit = { method, headers };

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
    const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    throw ToolError.rateLimited('Microsoft Graph API rate limit exceeded.', retryMs);
  }

  if (response.status === 401 || response.status === 403) {
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
