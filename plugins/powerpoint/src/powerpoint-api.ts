import {
  ToolError,
  buildQueryString,
  findLocalStorageEntry,
  getAuthCache,
  getLocalStorage,
  setAuthCache,
  clearAuthCache,
  waitUntil,
  parseRetryAfterMs,
} from '@opentabs-dev/plugin-sdk';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3';

// --- Auth ---

interface PowerPointAuth {
  token: string;
  driveId: string;
}

const getGraphToken = (): string | null => {
  const entry = findLocalStorageEntry(k => k.includes('accesstoken') && /(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(k));
  if (!entry) return null;
  try {
    const data = JSON.parse(entry.value) as { secret?: string; expiresOn?: string };
    if (!data.secret) return null;
    // Check expiry — expiresOn is a Unix timestamp in seconds
    if (data.expiresOn && Number(data.expiresOn) * 1000 < Date.now()) return null;
    return data.secret;
  } catch {
    return null;
  }
};

const getDriveId = (): string | null => {
  const url = new URL(window.location.href);
  const driveId = url.searchParams.get('driveId');
  if (driveId) return driveId;

  // Try to extract from the active MSAL account
  const activeAccount = getLocalStorage(`msal.${MSAL_CLIENT_ID}.active-account`);
  if (activeAccount) {
    // The account ID format is: 00000000-0000-0000-XXXX-XXXXXXXXXXXX where the last part is the drive ID
    const match = activeAccount.match(/00000000-0000-0000-([0-9a-f]{4}-[0-9a-f]{12})/i);
    if (match) {
      return match[1]?.replace('-', '').toUpperCase() ?? null;
    }
  }

  return null;
};

const getAuth = (): PowerPointAuth | null => {
  const cached = getAuthCache<PowerPointAuth>('powerpoint');
  if (cached) {
    // Re-verify the token is still valid
    const freshToken = getGraphToken();
    if (freshToken) {
      if (freshToken !== cached.token) {
        const updated = { ...cached, token: freshToken };
        setAuthCache('powerpoint', updated);
        return updated;
      }
      return cached;
    }
    clearAuthCache('powerpoint');
    return null;
  }

  const token = getGraphToken();
  if (!token) return null;

  const driveId = getDriveId();
  if (!driveId) return null;

  const auth: PowerPointAuth = { token, driveId };
  setAuthCache('powerpoint', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getCurrentDriveId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Microsoft 365.');
  return auth.driveId;
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

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403) {
      clearAuthCache('powerpoint');
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
