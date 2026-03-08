import { ToolError, getCookie, getPageGlobal, parseRetryAfterMs, waitUntil } from '@opentabs-dev/plugin-sdk';

const API_BASE = '/!api/2.0';

// --- Auth detection ---
// Bitbucket uses cookie-based session auth. The __app_data__ global
// contains user info when logged in. Mutating requests require
// a CSRF token from the csrftoken cookie.

const getAuth = (): { uuid: string } | null => {
  const uuid = getPageGlobal('__app_data__.user.uuid') as string | undefined;
  if (!uuid) return null;
  return { uuid };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

const getCsrfToken = (): string | null => getCookie('csrftoken');

// --- Shared fetch helpers ---

const buildUrl = (endpoint: string, query?: Record<string, string | number | boolean | undefined>): string => {
  let url = `${API_BASE}${endpoint}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
};

const handleFetchError = (err: unknown, endpoint: string): never => {
  if (err instanceof DOMException && err.name === 'TimeoutError')
    throw ToolError.timeout(`API request timed out: ${endpoint}`);
  if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
    category: 'internal',
    retryable: true,
  });
};

const handleHttpError = async (response: Response, endpoint: string): Promise<never> => {
  const errorBody = (await response.text().catch(() => '')).substring(0, 512);

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
  }
  if (response.status === 401 || response.status === 403)
    throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
  if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
  if (response.status === 400 || response.status === 422)
    throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
};

const requireAuth = (): void => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to Bitbucket.');
};

// --- Shared fetch wrapper ---

const doFetch = async (url: string, endpoint: string, init: RequestInit): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw handleFetchError(err, endpoint);
  }

  if (!response.ok) await handleHttpError(response, endpoint);
  return response;
};

// --- API callers ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  requireAuth();

  const url = buildUrl(endpoint, options.query);
  const headers: Record<string, string> = { Accept: 'application/json' };

  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  // Bitbucket requires a CSRF token for mutating requests when using session cookies.
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRFToken'] = csrf;
  }

  const response = await doFetch(url, endpoint, { method, headers, body: fetchBody });
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

// Variant that returns raw text (for file content, diffs, etc.)
export const apiRaw = async (
  endpoint: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<string> => {
  requireAuth();

  const url = buildUrl(endpoint, options.query);
  const response = await doFetch(url, endpoint, { method: options.method ?? 'GET' });
  return response.text();
};
