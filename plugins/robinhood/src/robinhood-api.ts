import {
  ToolError,
  buildQueryString,
  clearAuthCache,
  getAuthCache,
  getCookie,
  getLocalStorage,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://api.robinhood.com';
const BONFIRE_BASE = 'https://bonfire.robinhood.com';
const NUMMUS_BASE = 'https://nummus.robinhood.com';
const DORA_BASE = 'https://dora.robinhood.com';

interface RobinhoodAuth {
  accessToken: string;
  accountNumber: string;
}

const extractToken = (): string | null => {
  const raw = getLocalStorage('web:auth_state');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
};

const getAuth = (): RobinhoodAuth | null => {
  const cached = getAuthCache<RobinhoodAuth>('robinhood');
  if (cached?.accessToken) return cached;

  const accessToken = extractToken();
  if (!accessToken) return null;

  const auth: RobinhoodAuth = { accessToken, accountNumber: '' };
  setAuthCache('robinhood', auth);
  return auth;
};

export const isAuthenticated = (): boolean => {
  const loggedIn = getCookie('logged_in');
  if (loggedIn !== 'True') return false;
  return getAuth() !== null;
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

const getToken = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Robinhood.');
  return auth.accessToken;
};

/** Lazily fetches and caches the account number from the accounts endpoint. */
export const getAccountNumber = async (): Promise<string> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Robinhood.');
  if (auth.accountNumber) return auth.accountNumber;

  const data = await api<{ results: { account_number?: string }[] }>('/accounts/');
  const accountNumber = data.results?.[0]?.account_number ?? '';
  if (accountNumber) {
    auth.accountNumber = accountNumber;
    setAuthCache('robinhood', auth);
  }
  return accountNumber;
};

const classifyError = async (response: Response, endpoint: string): Promise<never> => {
  const errorBody = (await response.text().catch(() => '')).substring(0, 512);

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
  }
  if (response.status === 401 || response.status === 403) {
    clearAuthCache('robinhood');
    throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
  }
  if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
  if (response.status === 400) throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
  throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
};

const doFetch = async <T>(
  baseUrl: string,
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const token = getToken();

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${baseUrl}${endpoint}?${qs}` : `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let fetchBody: string | undefined;
  if (options.body) {
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

  if (!response.ok) return classifyError(response, endpoint);

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

/** Calls api.robinhood.com */
export const api = <T>(
  endpoint: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => doFetch<T>(API_BASE, endpoint, options);

/** Calls bonfire.robinhood.com */
export const bonfireApi = <T>(
  endpoint: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => doFetch<T>(BONFIRE_BASE, endpoint, options);

/** Calls nummus.robinhood.com (crypto) */
export const nummusApi = <T>(
  endpoint: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => doFetch<T>(NUMMUS_BASE, endpoint, options);

/** Calls dora.robinhood.com (feed/news) */
export const doraApi = <T>(
  endpoint: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => doFetch<T>(DORA_BASE, endpoint, options);
