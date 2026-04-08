import {
  ToolError,
  fetchJSON,
  fetchText,
  buildQueryString,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Auth ---

const AUTH_CACHE_KEY = 'datadog';

interface DatadogAuth {
  csrfToken: string;
}

const getCsrfToken = (): string | null => {
  try {
    const raw = localStorage.getItem('dd-csrf-token');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token ?? null;
  } catch {
    return null;
  }
};

const getAuth = (): DatadogAuth | null => {
  const cached = getAuthCache<DatadogAuth>(AUTH_CACHE_KEY);
  if (cached?.csrfToken) return cached;

  const csrfToken = getCsrfToken();
  if (!csrfToken) return null;

  const auth: DatadogAuth = { csrfToken };
  setAuthCache(AUTH_CACHE_KEY, auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

const requireAuth = (): DatadogAuth => {
  const auth = getAuth();
  if (!auth) {
    clearAuthCache(AUTH_CACHE_KEY);
    throw ToolError.auth('Not authenticated — please log in to Datadog.');
  }
  return auth;
};

// --- API Callers ---

/**
 * Make a GET request to Datadog API. Session cookies provide auth automatically.
 */
export const apiGet = async <T>(
  endpoint: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> => {
  requireAuth();
  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${endpoint}?${qs}` : endpoint;
  return fetchJSON<T>(url) as Promise<T>;
};

/**
 * Make a POST request to Datadog API with CSRF token.
 */
export const apiPost = async <T>(
  endpoint: string,
  body: unknown,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> => {
  const auth = requireAuth();
  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${endpoint}?${qs}` : endpoint;

  const bodyWithToken =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { ...body, _authentication_token: auth.csrfToken }
      : body;

  return fetchJSON<T>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': auth.csrfToken,
      'x-dd-csrf-token': auth.csrfToken,
    },
    body: JSON.stringify(bodyWithToken),
  }) as Promise<T>;
};

/**
 * Make a PUT request to Datadog API with CSRF token.
 */
export const apiPut = async <T>(endpoint: string, body: unknown): Promise<T> => {
  const auth = requireAuth();

  const bodyWithToken =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { ...body, _authentication_token: auth.csrfToken }
      : body;

  return fetchJSON<T>(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': auth.csrfToken,
      'x-dd-csrf-token': auth.csrfToken,
    },
    body: JSON.stringify(bodyWithToken),
  }) as Promise<T>;
};

/**
 * Make a DELETE request to Datadog API with CSRF token.
 */
export const apiDelete = async <T>(endpoint: string): Promise<T> => {
  const auth = requireAuth();

  return fetchJSON<T>(endpoint, {
    method: 'DELETE',
    headers: {
      'x-csrf-token': auth.csrfToken,
      'x-dd-csrf-token': auth.csrfToken,
    },
  }) as Promise<T>;
};

/**
 * Make a raw text GET request (for diffs, logs, etc.)
 */
export const apiGetText = async (
  endpoint: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<string> => {
  requireAuth();
  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${endpoint}?${qs}` : endpoint;
  return fetchText(url);
};

/**
 * Internal UI POST endpoint (uses /api/ui/ prefix pattern).
 */
export const apiUiPost = async <T>(endpoint: string, body: unknown): Promise<T> => {
  return apiPost<T>(`/api/ui${endpoint}`, body);
};

/**
 * Internal logs analytics POST (uses the internal v1 endpoint).
 */
export const searchLogsInternal = async <T>(body: unknown): Promise<T> => {
  return apiPost<T>('/api/v1/logs-analytics/list', body, { type: 'logs' });
};
