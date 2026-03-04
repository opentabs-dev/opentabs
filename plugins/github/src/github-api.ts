import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://api.github.com';

interface GitHubAuth {
  login: string;
}

// --- Auth detection ---
// GitHub uses HttpOnly session cookies (not accessible via document.cookie).
// Auth is detected via the <meta name="user-login"> tag that GitHub injects
// on every page for logged-in users. The actual API auth uses the session
// cookies sent automatically via credentials: 'include'.

const getAuth = (): GitHubAuth | null => {
  const loginMeta = document.querySelector<HTMLMetaElement>('meta[name="user-login"]');
  const login = loginMeta?.content;
  if (!login) return null;

  return { login };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isAuthenticated()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= maxWait) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });

export const getLogin = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to GitHub.');
  return auth.login;
};

// --- API caller ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
    accept?: string;
  } = {},
): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  let url = `${API_BASE}${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  // GitHub's REST API supports CORS with Access-Control-Allow-Origin: *
  // which is incompatible with credentials: 'include'. Use the user's
  // GitHub session cookie indirectly by extracting a CSRF token for
  // write operations. For read operations, unauthenticated access works
  // with standard rate limits. For authenticated requests, pass the
  // GitHub session cookie via a same-origin proxy or use the page's
  // embedded token.
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
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 422) throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

// Variant that returns raw text (for file contents)
export const apiRaw = async (
  endpoint: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean | undefined>;
    accept?: string;
  } = {},
): Promise<string> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

  let url = `${API_BASE}${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
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
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 422) throw ToolError.validation(`Validation error: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  return response.text();
};
