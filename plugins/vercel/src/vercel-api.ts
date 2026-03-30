import {
  ToolError,
  clearAuthCache,
  getAuthCache,
  getCookie,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Auth ---

interface VercelAuth {
  /** Team slug extracted from the current URL (e.g., "my-teams-projects-691c04ab") */
  teamSlug: string | null;
}

/**
 * Vercel uses an HttpOnly `authorization` cookie containing a Bearer token.
 * The browser sends it automatically with `credentials: 'include'`.
 * Auth status is detected from the non-HttpOnly `isLoggedIn` cookie.
 * The API is same-origin at `/api/`.
 */
const getAuth = (): VercelAuth | null => {
  const persisted = getAuthCache<VercelAuth>('vercel');
  if (persisted) return persisted;

  if (getCookie('isLoggedIn') !== '1') return null;

  const auth: VercelAuth = { teamSlug: extractTeamSlug() };
  setAuthCache('vercel', auth);
  return auth;
};

const EXCLUDED_PATHS = new Set(['account', 'login', 'signup', 'new', 'api', 'docs', 'blog', 'import', 'integrations']);

const extractTeamSlugFromPath = (pathname: string): string | null => {
  // URL pattern: /[teamSlug]/[project]/...
  const match = pathname.match(/^\/([a-z0-9][a-z0-9-]+)\//);
  if (match?.[1] && !EXCLUDED_PATHS.has(match[1])) return match[1];
  return null;
};

const extractTeamSlug = (): string | null => extractTeamSlugFromPath(window.location.pathname);

// --- Public auth helpers ---

export const isVercelAuthenticated = (): boolean => getAuth() !== null;

export const waitForVercelAuth = (): Promise<boolean> =>
  waitUntil(() => isVercelAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/** Get the team slug from the current URL, if present */
export const getTeamSlug = (): string | null => {
  const auth = getAuth();
  return auth?.teamSlug ?? extractTeamSlug();
};

/** Re-extract the team slug from the given URL and update the auth cache. No-op if not authenticated. */
export const updateCachedTeamSlug = (url: string): void => {
  const cached = getAuthCache<VercelAuth>('vercel');
  if (!cached) return;

  const pathname = new URL(url).pathname;
  const teamSlug = extractTeamSlugFromPath(pathname);
  if (teamSlug !== cached.teamSlug) {
    setAuthCache('vercel', { ...cached, teamSlug });
  }
};

// --- API caller ---

type QueryValue = string | number | boolean | undefined;

export const vercelApi = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, QueryValue | QueryValue[]>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Vercel.');

  // Build URL — Vercel API is same-origin at /api/
  let url = `/api${endpoint}`;
  const mergedQuery: Record<string, QueryValue | QueryValue[]> = { ...options.query };

  // Auto-inject teamId/slug for team-scoped requests
  if (auth.teamSlug && !mergedQuery.teamId && !mergedQuery.slug) {
    mergedQuery.slug = auth.teamSlug;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(mergedQuery)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined) params.append(key, String(v));
      }
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const headers: Record<string, string> = {};
  let fetchBody: string | undefined;

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ToolError('Request was aborted', 'aborted');
    }
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
      clearAuthCache('vercel');
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    }
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
