import {
  ToolError,
  findLocalStorageEntry,
  getCurrentUrl,
  getLocalStorage,
  getPreScriptValue,
  waitUntil,
  parseRetryAfterMs,
  buildQueryString,
} from '@opentabs-dev/plugin-sdk';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** localStorage key the pre-script mirrors the captured Graph token to. */
const LS_TOKEN_KEY = '__opentabs_excel_graph_token';

// --- Auth ---
//
// Two token sources, tried in order:
//   1. The Graph token captured by the pre-script from MSAL's token-endpoint
//      responses. This is the path that works on SharePoint/OneDrive-hosted
//      workbooks, where MSAL's localStorage cache is encrypted.
//   2. A plaintext MSAL access token in localStorage, used by the standalone
//      `excel.cloud.microsoft` app, which keys its Graph token by client id.

interface CapturedGraphToken {
  token: string;
  /** Unix epoch seconds. */
  exp: number;
}

/**
 * Read a value the pre-script stashed under the `excel-online` namespace.
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
    ?.preScript?.['excel-online'];
  return ns?.[key] as T | undefined;
};

/** A captured token is usable if it has a non-empty value and is not about to expire. */
const usableToken = (captured: CapturedGraphToken | undefined | null): string | null => {
  if (!captured || typeof captured.token !== 'string' || captured.token.length === 0) return null;
  if (typeof captured.exp !== 'number' || captured.exp <= Math.floor(Date.now() / 1000) + 30) return null;
  return captured.token;
};

/**
 * The Graph token captured by the pre-script. Checked in two places: the
 * in-page pre-script namespace (set on the current load) and the localStorage
 * mirror (persisted across warm reloads and same-origin tabs for the token's
 * lifetime).
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
 * A plaintext Graph access token from MSAL's localStorage cache.
 *
 * Used on the standalone `excel.cloud.microsoft` app, where MSAL.js stores
 * `secret` plaintext. Enterprise SharePoint pages encrypt the `data` field
 * (their entries have no `secret`), so the predicate naturally skips them and
 * the pre-script's captured token is used instead. We match by key shape
 * rather than hardcoding a client ID — consumer vs enterprise tenants use
 * different IDs, and any plaintext Graph AT in storage is fair game.
 */
const getLocalStorageToken = (): string | null => {
  const entry = findLocalStorageEntry(
    key => key.includes('accesstoken') && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key),
  );
  if (!entry) return null;

  try {
    const parsed = JSON.parse(entry.value) as Record<string, unknown>;
    if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) return null;
    // MSAL stores `expiresOn` as a unix-epoch-seconds string. A missing or
    // unparseable value means we cannot prove the token is live — treat it as
    // expired rather than risk returning a stale token (MSAL leaves expired AT
    // entries in storage until the next refresh).
    const expiresOn = Number.parseInt(String(parsed.expiresOn ?? '0'), 10);
    if (!(expiresOn > Math.floor(Date.now() / 1000))) return null;
    return parsed.secret;
  } catch {
    return null;
  }
};

const getToken = (): string | null => getCapturedToken() ?? getLocalStorageToken();

export const isAuthenticated = (): boolean => getToken() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );

/** True when the current tab is a SharePoint/OneDrive-hosted Excel workbook. */
export const isSharePointWorkbook = (): boolean => {
  try {
    const url = new URL(getCurrentUrl());
    return url.hostname.endsWith('.sharepoint.com') && url.pathname.includes('/:x:/');
  } catch {
    return false;
  }
};

// --- Workbook context from URL ---

interface WorkbookContext {
  driveId: string;
  itemId: string;
}

/**
 * Per-tab cache keyed by the page URL. The Office apps are SPAs — same-tab
 * navigation to a different workbook changes `getCurrentUrl()` without
 * reloading the adapter, so a single-slot cache would silently return the
 * wrong drive/item. Comparing the URL on every read invalidates the cache
 * exactly when the workbook identity changes.
 */
let cached: { url: string; ctx: WorkbookContext } | null = null;

/** Encode a sharing URL into a Graph `/shares` share id (unpadded base64url with a `u!` prefix). */
const encodeShareId = (sharingUrl: string): string => {
  const bytes = new TextEncoder().encode(sharingUrl);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return `u!${base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

/** Resolve the drive item behind a SharePoint/OneDrive sharing URL via Graph `/shares`. */
const resolveViaShares = async (sharingUrl: string): Promise<WorkbookContext> => {
  const item = await api<{ id?: string; parentReference?: { driveId?: string } }>(
    `/shares/${encodeShareId(sharingUrl)}/driveItem`,
    { query: { $select: 'id,parentReference' } },
  );
  const driveId = item.parentReference?.driveId;
  if (!driveId || !item.id) {
    throw ToolError.notFound('Could not resolve the workbook from the current SharePoint URL.');
  }
  return { driveId, itemId: item.id };
};

/**
 * Resolve the open workbook's drive and item ids.
 *
 * The standalone `excel.cloud.microsoft` app carries `driveId`/`docId` in the
 * URL query. SharePoint/OneDrive-hosted workbooks identify the file by a
 * sharing token in the path, which we resolve to `{driveId, itemId}` through
 * the Graph `/shares` endpoint.
 */
export const resolveWorkbookContext = async (): Promise<WorkbookContext> => {
  const currentUrl = getCurrentUrl();
  if (cached && cached.url === currentUrl) return cached.ctx;
  const url = new URL(currentUrl);
  const driveId = url.searchParams.get('driveId');
  const docId = url.searchParams.get('docId');
  if (driveId && docId) {
    const ctx = { driveId, itemId: docId };
    cached = { url: currentUrl, ctx };
    return ctx;
  }
  if (url.hostname.endsWith('.sharepoint.com')) {
    const ctx = await resolveViaShares(url.href);
    cached = { url: currentUrl, ctx };
    return ctx;
  }
  throw ToolError.validation('No workbook is currently open. Please open an Excel workbook in the browser first.');
};

// --- API caller ---

/**
 * Trailing guidance appended to AUTH_ERROR messages on SharePoint/OneDrive
 * pages. MSAL's encrypted cache means we can't recover in-place — the only
 * reliable path is to clear MSAL state and reload, which the
 * `excel-online_reauthenticate` tool does.
 */
const SP_REAUTH_HINT = 'Call `excel-online_reauthenticate` to recover.';

const authError = (msg: string): never => {
  throw ToolError.auth(isSharePointWorkbook() ? `${msg} ${SP_REAUTH_HINT}` : msg);
};

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const token = getToken();
  if (!token) authError('Not authenticated — please log in to Microsoft 365.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let fetchBody: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
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

    if (response.status === 401) authError(`Auth error (401): ${errorBody}`);
    if (response.status === 403) authError(`Forbidden (403): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 400 || response.status === 422)
      throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

// --- Workbook API helper ---

export const workbookApi = async <T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const ctx = await resolveWorkbookContext();
  const endpoint = `/drives/${ctx.driveId}/items/${encodeURIComponent(ctx.itemId)}/workbook${path}`;
  return api<T>(endpoint, options);
};

// --- User API helper ---

export const getUserInfo = async (): Promise<{ displayName: string; mail: string; id: string }> => {
  return api('/me');
};
