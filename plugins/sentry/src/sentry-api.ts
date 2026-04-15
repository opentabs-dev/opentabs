import {
  ToolError,
  clearAuthCache,
  getAuthCache,
  getCookie,
  getPageGlobal,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Auth ---

interface SentryAuth {
  /** Organization slug extracted from the current URL */
  orgSlug: string;
}

/**
 * Sentry uses HttpOnly session cookies for the web UI.
 * The browser sends them automatically with `credentials: 'include'`.
 * Auth status is detected from `window.__initialData.isAuthenticated` and the
 * `sentry-sc` cookie (non-HttpOnly CSRF token that indicates an active session).
 * Write operations require an `X-CSRFToken` header with the `sentry-sc` cookie value.
 */
const getAuth = (): SentryAuth | null => {
  const cached = getAuthCache<SentryAuth>('sentry');
  if (cached) return cached;

  const orgSlug = extractOrgSlug();
  if (!orgSlug) return null;

  const isAuthed = detectAuthentication();
  if (!isAuthed) return null;

  const auth: SentryAuth = { orgSlug };
  setAuthCache('sentry', auth);
  return auth;
};

const extractOrgSlug = (): string | null => {
  const hostname = window.location.hostname;
  // Pattern: <org-slug>.sentry.io (SaaS)
  const subdomainMatch = hostname.match(/^([a-z0-9-]+)\.sentry\.io$/);
  if (
    subdomainMatch?.[1] &&
    subdomainMatch[1] !== 'sentry' &&
    subdomainMatch[1] !== 'docs' &&
    subdomainMatch[1] !== 'blog'
  ) {
    return subdomainMatch[1];
  }

  // Self-hosted and sentry.io path-based: /organizations/<org-slug>/
  const pathMatch = window.location.pathname.match(/^\/organizations\/([a-z0-9_-]+)\//);
  if (pathMatch?.[1]) return pathMatch[1];

  return null;
};

const detectAuthentication = (): boolean => {
  // Primary: check window.__initialData.isAuthenticated (set by Sentry's server-rendered bootstrap)
  if (getPageGlobal('__initialData.isAuthenticated') === true) return true;

  // Secondary: check for the sentry-sc CSRF cookie (non-HttpOnly, present when session is active)
  if (getCookie('sentry-sc') !== null) return true;

  // Fallback: if we're on a sentry.io org subdomain and not on a login page
  const isLoginPage = window.location.pathname.includes('/auth/login');
  const isSentryIoOrg = /^[a-z0-9-]+\.sentry\.io$/.test(window.location.hostname);
  if (!isLoginPage && isSentryIoOrg) return true;

  return false;
};

/** Extract the CSRF token from the `sentry-sc` cookie for write operations */
const getCsrfToken = (): string | null => getCookie('sentry-sc');

// --- Public auth helpers ---

export const isSentryAuthenticated = (): boolean => getAuth() !== null;

export const waitForSentryAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isSentryAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

export const getOrgSlug = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Sentry.');
  return auth.orgSlug;
};

// --- Pagination ---

/** Parse the next cursor from the Link header returned by Sentry's paginated APIs. */
const parseLinkCursor = (headers: Headers): string | undefined => {
  const link = headers.get('Link');
  if (!link) return undefined;
  const nextMatch = link.match(/<[^>]*[?&]cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/);
  return nextMatch?.[1] ?? undefined;
};

// --- API caller ---

export interface SentryApiResult<T> {
  data: T;
  nextCursor?: string;
}

type QueryValue = string | number | boolean | undefined;

export const sentryApi = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, QueryValue | QueryValue[]>;
  } = {},
): Promise<SentryApiResult<T>> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Sentry.');

  // Build URL — Sentry API is same-origin at /api/0/
  let url = `/api/0${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
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
  }

  const headers: Record<string, string> = {};
  let fetchBody: string | undefined;

  // Write operations require the CSRF token
  const method = options.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

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
      throw ToolError.timeout('Request was aborted');
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
      clearAuthCache('sentry');
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    }
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  const nextCursor = parseLinkCursor(response.headers);
  if (response.status === 204) return { data: {} as T, nextCursor };
  return { data: (await response.json()) as T, nextCursor };
};
