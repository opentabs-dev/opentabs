import {
  ToolError,
  clearAuthCache,
  getAuthCache,
  getLocalStorage,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const TOKEN_KEY = 'supabase.dashboard.auth.token';
const NAMESPACE = 'supabase';

interface SupabaseAuth {
  accessToken: string;
}

const getAuth = (): SupabaseAuth | null => {
  const persisted = getAuthCache<SupabaseAuth>(NAMESPACE);
  if (persisted) return persisted;

  try {
    const raw = getLocalStorage(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      expires_at?: number;
    };
    const token = parsed.access_token;
    if (!token) return null;
    const auth: SupabaseAuth = { accessToken: token };
    setAuthCache(NAMESPACE, auth);
    return auth;
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | string;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Supabase.');

  let url = `https://api.supabase.com/v1${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
  };
  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === 'AbortError') throw ToolError.timeout('Request was aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);

    if (response.status === 401 || response.status === 403) {
      clearAuthCache(NAMESPACE);
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
};
