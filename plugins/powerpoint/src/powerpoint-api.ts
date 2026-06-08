import {
  buildQueryString,
  findLocalStorageEntry,
  getCurrentUrl,
  getLocalStorage,
  getPageGlobal,
  getPreScriptValue,
  parseRetryAfterMs,
  ToolError,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';
/** localStorage key the pre-script mirrors the captured Graph token to. */
const LS_TOKEN_KEY = '__opentabs_powerpoint_graph_token';

// --- SharePoint detection ---

/** True when the current tab is hosted on a SharePoint/OneDrive site. */
export const isSharePoint = (): boolean => {
  try {
    return new URL(getCurrentUrl()).hostname.toLowerCase().endsWith('.sharepoint.com');
  } catch {
    return false;
  }
};

/**
 * Whether the current tab is a PowerPoint document.
 * Accepts the dedicated PowerPoint cloud app, SharePoint PowerPoint viewer URLs (`/:p:/`),
 * and any URL referencing a `.ppt`/`.pptx`/`.pptm`/`.ppsx` file.
 */
export const isPowerPointTab = (): boolean => {
  const url = getCurrentUrl();
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // Malformed URL — fall through to URL pattern checks
  }
  if (host === 'powerpoint.cloud.microsoft') return true;
  if (/\/:p:\//i.test(url)) return true;
  if (/\.(?:pptx?|pptm|ppsx?)(?:[?#]|$)/i.test(url)) return true;
  return false;
};

// --- Auth ---
//
// Two token sources, tried in order:
//   1. The Graph token captured by the pre-script from MSAL's token-endpoint
//      responses — the path that works on SharePoint/OneDrive-hosted
//      presentations, where MSAL's localStorage cache is encrypted.
//   2. A plaintext MSAL access token in localStorage, used by the standalone
//      `powerpoint.cloud.microsoft` app.

interface PowerPointAuth {
  token: string;
  driveId: string;
}

interface CapturedGraphToken {
  token: string;
  /** Unix epoch seconds. */
  exp: number;
}

/**
 * Read a value the pre-script stashed under the `powerpoint` namespace.
 *
 * `getPreScriptValue` depends on `globalThis.__openTabs._pluginName`, which the
 * adapter only binds during tool dispatch — so it returns `undefined` in
 * `isReady()`. We try the SDK helper first, then fall back to a direct read.
 */
const readPreScriptValue = <T>(key: string): T | undefined => {
  const viaSdk = getPreScriptValue<T>(key);
  if (viaSdk !== undefined) return viaSdk;
  const ns = (globalThis as { __openTabs?: { preScript?: Record<string, Record<string, unknown>> } }).__openTabs
    ?.preScript?.powerpoint;
  return ns?.[key] as T | undefined;
};

const usableToken = (captured: CapturedGraphToken | undefined | null): string | null => {
  if (!captured || typeof captured.token !== 'string' || captured.token.length === 0) return null;
  if (typeof captured.exp !== 'number' || captured.exp <= Math.floor(Date.now() / 1000) + 30) return null;
  return captured.token;
};

/** The Graph token captured by the pre-script (in-page namespace, then localStorage mirror). */
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

/** A plaintext Graph access token from the standalone app's MSAL localStorage. */
const getMsalToken = (): string | null => {
  const entry = findLocalStorageEntry(
    k =>
      k.includes('accesstoken') && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(k) && k.includes(MSAL_CLIENT_ID),
  );
  if (!entry) return null;
  try {
    const data = JSON.parse(entry.value) as Record<string, unknown>;
    if (typeof data.secret !== 'string' || data.secret.length === 0) return null;
    // MSAL stores `expiresOn` as a unix-epoch-seconds string. A missing or
    // unparseable value means we cannot prove the token is live — treat it as
    // expired rather than risk returning a stale token.
    const expiresOn = Number.parseInt(String(data.expiresOn ?? '0'), 10);
    if (!(expiresOn > Math.floor(Date.now() / 1000))) return null;
    return data.secret;
  } catch {
    return null;
  }
};

const getToken = (): string | null => getCapturedToken() ?? getMsalToken();

export const isAuthenticated = (): boolean => getToken() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );

// --- Drive / item context ---

/** Read the drive id synchronously from the URL query, the WOPI context, or the MSAL account. */
const getDriveIdSync = (): string | null => {
  // Primary: URL query param (powerpoint.cloud.microsoft)
  const url = new URL(getCurrentUrl());
  const urlDriveId = url.searchParams.get('driveId');
  if (urlDriveId) return urlDriveId;

  // SharePoint-hosted files: read from the WOPI context global
  const wopiDriveId = getPageGlobal('_wopiContextJson.DriveId') as string | undefined;
  if (wopiDriveId) return wopiDriveId;

  // Fallback: extract from the active MSAL account (powerpoint.cloud.microsoft)
  const activeAccount = getLocalStorage(`msal.${MSAL_CLIENT_ID}.active-account`);
  if (activeAccount) {
    const match = activeAccount.match(/00000000-0000-0000-([0-9a-f]{4}-[0-9a-f]{12})/i);
    if (match) return match[1]?.replace(/-/g, '').toUpperCase() ?? null;
  }

  return null;
};

/** Encode a sharing URL into a Graph `/shares` share id (unpadded base64url with a `u!` prefix). */
const encodeShareId = (sharingUrl: string): string => {
  const bytes = new TextEncoder().encode(sharingUrl);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return `u!${base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

/**
 * Per-tab cache keyed by the page URL. The Office apps are SPAs — same-tab
 * navigation to a different presentation changes `getCurrentUrl()` without
 * reloading the adapter, so a single-slot cache would silently return the
 * wrong drive. Comparing the URL on every read invalidates the cache exactly
 * when the presentation identity changes.
 */
let cached: { url: string; driveId: string } | null = null;

/**
 * Resolve the current drive id. Uses the synchronous sources first, then falls
 * back to the Graph `/shares` endpoint for SharePoint URLs whose WOPI context
 * has not exposed a drive id. Uses a token-only request to avoid recursing
 * through `requireAuth`.
 */
const resolveDriveId = async (token: string): Promise<string | null> => {
  const currentUrl = getCurrentUrl();
  if (cached && cached.url === currentUrl) return cached.driveId;
  const sync = getDriveIdSync();
  if (sync) {
    cached = { url: currentUrl, driveId: sync };
    return sync;
  }
  if (isSharePoint()) {
    try {
      const shareId = encodeShareId(currentUrl);
      const response = await fetch(`${GRAPH_BASE}/shares/${shareId}/driveItem?$select=id,parentReference`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const item = (await response.json()) as { parentReference?: { driveId?: string } };
        const driveId = item.parentReference?.driveId;
        if (driveId) {
          cached = { url: currentUrl, driveId };
          return driveId;
        }
      }
    } catch {
      /* fall through to null */
    }
  }
  return null;
};

/** Get the current file's item ID from the SharePoint WOPI context, if present. */
export const getCurrentItemId = (): string | null => {
  const wopiItemId = getPageGlobal('_wopiContextJson.DriveItemId') as string | undefined;
  return wopiItemId ?? null;
};

/**
 * Return the current auth context, throwing an actionable error if unavailable.
 * The Graph token comes from the pre-script capture (SharePoint) or the
 * standalone app's plaintext MSAL cache; the drive id from the URL, the WOPI
 * context, or Graph `/shares`.
 */
export const requireAuth = async (): Promise<PowerPointAuth> => {
  const token = getToken();
  if (!token) throw ToolError.auth('Not authenticated — please log in to Microsoft 365.');
  const driveId = await resolveDriveId(token);
  if (!driveId) {
    throw ToolError.validation('Could not determine the current drive. Open a presentation in the browser first.');
  }
  return { token, driveId };
};

export const getCurrentDriveId = async (): Promise<string> => (await requireAuth()).driveId;

// --- API caller ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = await requireAuth();

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${GRAPH_BASE}${endpoint}?${qs}` : `${GRAPH_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
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

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403) {
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 400 || response.status === 409)
      throw ToolError.validation(`Validation error (${response.status}): ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 202 || response.status === 204) return {} as T;
  return (await response.json()) as T;
};
