import {
  ToolError,
  findLocalStorageEntry,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  getCurrentUrl,
  waitUntil,
  parseRetryAfterMs,
  buildQueryString,
} from '@opentabs-dev/plugin-sdk';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';

// --- Auth: MSAL tokens from localStorage ---

interface ExcelAuth {
  token: string;
}

const getGraphToken = (): string | null => {
  // Search localStorage for MSAL access tokens scoped to Graph API
  const entry = findLocalStorageEntry(
    key => key.includes('accesstoken') && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key) && key.includes(MSAL_CLIENT_ID),
  );
  if (!entry) return null;

  try {
    const parsed = JSON.parse(entry.value);
    if (!parsed.secret) return null;

    // Check expiry — MSAL stores Unix timestamps as strings
    const expiresOn = Number.parseInt(parsed.expires_on, 10);
    if (expiresOn && expiresOn < Math.floor(Date.now() / 1000)) return null;

    return parsed.secret as string;
  } catch {
    return null;
  }
};

const getAuth = (): ExcelAuth | null => {
  const cached = getAuthCache<ExcelAuth>('excel-online');
  if (cached) {
    // Verify the cached token is still valid by re-reading from localStorage
    const fresh = getGraphToken();
    if (fresh && fresh === cached.token) return cached;
    if (fresh) {
      const auth: ExcelAuth = { token: fresh };
      setAuthCache('excel-online', auth);
      return auth;
    }
    clearAuthCache('excel-online');
    return null;
  }

  const token = getGraphToken();
  if (!token) return null;

  const auth: ExcelAuth = { token };
  setAuthCache('excel-online', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- Workbook context from URL ---

interface WorkbookContext {
  driveId: string;
  itemId: string;
}

export const getWorkbookContext = (): WorkbookContext | null => {
  const url = new URL(getCurrentUrl());
  const driveId = url.searchParams.get('driveId');
  const docId = url.searchParams.get('docId');
  if (driveId && docId) return { driveId, itemId: docId };
  return null;
};

const requireWorkbookContext = (): WorkbookContext => {
  const ctx = getWorkbookContext();
  if (!ctx) {
    throw ToolError.validation('No workbook is currently open. Please open an Excel workbook in the browser first.');
  }
  return ctx;
};

// --- API caller ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Microsoft 365.');

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

    // On 401, clear the cached auth so it re-reads on next call
    if (response.status === 401) {
      clearAuthCache('excel-online');
      throw ToolError.auth(`Auth error (401): ${errorBody}`);
    }
    if (response.status === 403) throw ToolError.auth(`Forbidden (403): ${errorBody}`);
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
  const ctx = requireWorkbookContext();
  const endpoint = `/drives/${ctx.driveId}/items/${encodeURIComponent(ctx.itemId)}/workbook${path}`;
  return api<T>(endpoint, options);
};

// --- User API helper ---

export const getUserInfo = async (): Promise<{ displayName: string; mail: string; id: string }> => {
  return api('/me');
};
