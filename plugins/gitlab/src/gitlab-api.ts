import {
  ToolError,
  getConfig,
  getMetaContent,
  getPageGlobal,
  parseRetryAfterMs,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const getApiBase = (): string => {
  const instanceUrl = getConfig('instanceUrl') as string | undefined;
  if (instanceUrl) return `${instanceUrl.replace(/\/+$/, '')}/api/v4`;
  return 'https://gitlab.com/api/v4';
};

interface GitLabAuth {
  username: string;
}

// --- Auth detection ---
// GitLab injects a <meta name="csrf-token"> tag for CSRF protection on
// mutating requests, and user info is embedded in the gon global object
// (window.gon). Auth is detected via the gon object which contains the
// current user's username when logged in.

const getAuth = (): GitLabAuth | null => {
  const username = getPageGlobal('gon.current_username') as string | undefined;
  if (typeof username !== 'string' || !username) return null;
  return { username };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getUsername = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to GitLab.');
  return auth.username;
};

const getCsrfToken = (): string | null => getMetaContent('csrf-token');

// --- Shared fetch helpers ---

const buildUrl = (endpoint: string, query?: Record<string, string | number | boolean | undefined>): string => {
  let url = `${getApiBase()}${endpoint}`;
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
  if (err instanceof DOMException && err.name === 'AbortError') throw ToolError.timeout('Request was aborted');
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
  if (response.status === 422) throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
};

const requireAuth = (): void => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitLab.');
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
    // handleFetchError always throws; re-throw to satisfy control flow analysis.
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

  // GitLab requires a CSRF token for mutating requests when using session cookies.
  const method = options.method ?? 'GET';
  if (method !== 'GET') {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const response = await doFetch(url, endpoint, { method, headers, body: fetchBody });
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

// Variant that returns raw text (for job logs, etc.)
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
