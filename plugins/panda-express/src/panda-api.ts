import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

/**
 * Panda Express uses Olo (NomNom) APIs proxied through the same origin.
 * Auth is handled via an authtoken stored in Redux persist (localStorage persist:root).
 * The authtoken is used as a path segment for user-specific endpoints (e.g., /users/{authtoken}/recentorders).
 */

const getAuthToken = (): string | null => {
  try {
    const root = localStorage.getItem('persist:root');
    if (!root) return null;
    const parsed = JSON.parse(root) as Record<string, string>;
    const appState = JSON.parse(parsed.appState ?? '{}') as Record<string, Record<string, string>>;
    return appState?.authentication?.authtoken ?? null;
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => getAuthToken() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 500;
      if (isAuthenticated()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= 5000) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });

export const getRequiredAuthToken = (): string => {
  const token = getAuthToken();
  if (!token) throw ToolError.auth('Not authenticated — please log in to Panda Express.');
  return token;
};

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  let url = endpoint;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
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
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`Timed out: ${endpoint}`);
    }
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw ToolError.rateLimited(`Rate limited: ${endpoint}`, retryAfter ? parseRetryAfterMs(retryAfter) : undefined);
    }
    if (response.status === 401 || response.status === 403) {
      throw ToolError.auth(`Auth error (${response.status}): ${body}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Not found: ${endpoint}`);
    }
    if (response.status === 422) {
      throw ToolError.validation(`Validation error: ${body}`);
    }
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${body}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
