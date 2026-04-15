import { ToolError, getCookie, waitUntil } from '@opentabs-dev/plugin-sdk';

/**
 * Modhash token required for write operations (vote, comment, submit, etc.).
 * Fetched once from /api/me.json and cached for the session lifetime.
 */
let cachedModhash: string | null = null;

/**
 * OAuth bearer token for endpoints that require oauth.reddit.com.
 * Some endpoints (e.g., /api/compose) reject cookie-based auth on
 * www.reddit.com and require a bearer token on oauth.reddit.com instead.
 * Fetched from the shreddit token endpoint and cached until expiry.
 */
let cachedBearerToken: string | null = null;
let bearerTokenExpiry = 0;

/**
 * Check if the user is logged in by looking for the `user-logged-in` attribute
 * on the `<shreddit-app>` element (new Reddit UI).
 */
const isAuthenticated = (): boolean => {
  const app = document.querySelector('shreddit-app');
  if (app?.getAttribute('user-logged-in') === 'true') return true;

  // Old Reddit fallback: check for the logged-in user link
  const userSpan = document.querySelector('.user a');
  if (userSpan && !userSpan.textContent?.includes('login')) return true;

  return false;
};

/**
 * Wait for Reddit auth to become available, retrying at short intervals.
 * The SPA hydrates asynchronously, so the auth attribute may not be set
 * on the first check. Polls at 500ms intervals for up to 3 seconds.
 */
const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 3000 }).then(
    () => true,
    () => false,
  );

/**
 * Fetch and cache the modhash token from /api/me.json.
 * The modhash is a CSRF token required for all write operations.
 */
const getModhash = async (): Promise<string> => {
  if (cachedModhash) return cachedModhash;

  const response = await fetch('https://www.reddit.com/api/me.json', {
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw ToolError.auth(`Failed to fetch modhash: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data?: { modhash?: string } };
  const modhash = data.data?.modhash;
  if (!modhash) {
    throw ToolError.auth('No modhash found — user may not be logged in');
  }

  cachedModhash = modhash;
  return modhash;
};

/**
 * Fetch and cache an OAuth bearer token from the shreddit token endpoint.
 * The new Reddit UI (shreddit) exposes a token endpoint that exchanges
 * the CSRF cookie for a short-lived bearer token usable on oauth.reddit.com.
 */
const getBearerToken = async (): Promise<string> => {
  if (cachedBearerToken && Date.now() < bearerTokenExpiry) return cachedBearerToken;

  const csrfToken = getCookie('csrf_token') ?? '';
  const response = await fetch('https://www.reddit.com/svc/shreddit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrf_token: csrfToken }),
    credentials: 'include',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw ToolError.auth(`Failed to fetch bearer token: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { token?: string; expires?: string };
  if (!data.token) {
    throw ToolError.auth('No bearer token returned — user may not be logged in');
  }

  cachedBearerToken = data.token;
  bearerTokenExpiry = data.expires ? new Date(data.expires).getTime() - 30_000 : Date.now() + 600_000;
  return cachedBearerToken;
};

/**
 * Reddit API response wrapper. All .json endpoints return data wrapped in
 * a Listing structure with `kind` and `data` fields.
 */
interface RedditListing<T> {
  kind: string;
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: string; data: T }>;
    dist: number;
    modhash?: string;
  };
}

/**
 * Make an authenticated GET request to a Reddit .json endpoint.
 * Cookies handle authentication automatically via credentials: 'include'.
 *
 * @param path - URL path relative to reddit.com (e.g., '/r/programming/hot.json')
 * @param params - Query parameters
 * @returns Parsed JSON response
 */
const redditGet = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const url = new URL(path, 'https://www.reddit.com');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw ToolError.timeout('Reddit API request timed out after 30000ms');
    }
    throw ToolError.internal(`Reddit API network error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset');
    const retryMs = reset ? Number.parseInt(reset, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Reddit API rate limited (429)', retryMs);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      throw ToolError.auth(`Reddit API HTTP ${response.status}: ${errorText}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Reddit API HTTP ${response.status}: ${errorText}`);
    }
    throw ToolError.internal(`Reddit API HTTP ${response.status}: ${errorText}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw ToolError.internal('Failed to parse Reddit API response');
  }
};

/**
 * Make an authenticated POST request to a Reddit API endpoint.
 * Includes the modhash as X-Modhash header for CSRF protection.
 *
 * @param path - API path (e.g., '/api/comment')
 * @param body - Form body parameters
 * @returns Parsed JSON response
 */
const redditPost = async <T>(path: string, body: Record<string, string>): Promise<T> => {
  const modhash = await getModhash();

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== '') {
      form.append(key, value);
    }
  }
  form.append('uh', modhash);
  form.append('api_type', 'json');

  let response: Response;
  try {
    response = await fetch(`https://www.reddit.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Modhash': modhash,
      },
      body: form.toString(),
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw ToolError.timeout('Reddit API request timed out after 30000ms');
    }
    throw ToolError.internal(`Reddit API network error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset');
    const retryMs = reset ? Number.parseInt(reset, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Reddit API rate limited (429)', retryMs);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      clearSessionCache();
      throw ToolError.auth(`Reddit API HTTP ${response.status}: ${errorText}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Reddit API HTTP ${response.status}: ${errorText}`);
    }
    throw ToolError.internal(`Reddit API HTTP ${response.status}: ${errorText}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw ToolError.internal('Failed to parse Reddit API response');
  }
};

/**
 * Make an authenticated POST request to oauth.reddit.com using a bearer token.
 * Some endpoints (e.g., /api/compose for private messages) reject cookie-based
 * auth on www.reddit.com and require bearer auth on the OAuth domain instead.
 *
 * @param path - API path (e.g., '/api/compose')
 * @param body - Form body parameters
 * @returns Parsed JSON response
 */
const redditOAuthPost = async <T>(path: string, body: Record<string, string>): Promise<T> => {
  const token = await getBearerToken();

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== '') {
      form.append(key, value);
    }
  }
  form.append('api_type', 'json');

  let response: Response;
  try {
    response = await fetch(`https://oauth.reddit.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token}`,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw ToolError.timeout('Reddit OAuth API request timed out after 30000ms');
    }
    throw ToolError.internal(
      `Reddit OAuth API network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset');
    const retryMs = reset ? Number.parseInt(reset, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Reddit API rate limited (429)', retryMs);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (response.status === 401 || response.status === 403) {
      clearSessionCache();
      throw ToolError.auth(`Reddit OAuth API HTTP ${response.status}: ${errorText}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Reddit OAuth API HTTP ${response.status}: ${errorText}`);
    }
    throw ToolError.internal(`Reddit OAuth API HTTP ${response.status}: ${errorText}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw ToolError.internal('Failed to parse Reddit OAuth API response');
  }
};

/**
 * Clear all cached session credentials (modhash and bearer token).
 * Called on teardown and when auth errors indicate stale credentials.
 */
const clearSessionCache = (): void => {
  cachedModhash = null;
  cachedBearerToken = null;
  bearerTokenExpiry = 0;
};

export { isAuthenticated, waitForAuth, redditGet, redditPost, redditOAuthPost, clearSessionCache };
export type { RedditListing };
