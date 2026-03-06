import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

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
  const persisted = getPersistedAuth();
  if (persisted) return persisted;

  const orgSlug = extractOrgSlug();
  if (!orgSlug) return null;

  const isAuthed = detectAuthentication();
  if (!isAuthed) return null;

  const auth: SentryAuth = { orgSlug };
  setPersistedAuth(auth);
  return auth;
};

const extractOrgSlug = (): string | null => {
  const hostname = window.location.hostname;
  // Pattern: <org-slug>.sentry.io
  const match = hostname.match(/^([a-z0-9-]+)\.sentry\.io$/);
  if (match?.[1] && match[1] !== 'sentry' && match[1] !== 'docs' && match[1] !== 'blog') {
    return match[1];
  }
  return null;
};

const detectAuthentication = (): boolean => {
  // Primary: check window.__initialData.isAuthenticated (set by Sentry's server-rendered bootstrap)
  const initialData = (window as unknown as Record<string, unknown>).__initialData as
    | Record<string, unknown>
    | undefined;
  if (initialData?.isAuthenticated === true) return true;

  // Secondary: check for the sentry-sc CSRF cookie (non-HttpOnly, present when session is active)
  if (document.cookie.includes('sentry-sc=')) return true;

  // Fallback: if we're on an org subdomain and not on a login page
  const isLoginPage = window.location.pathname.includes('/auth/login');
  if (!isLoginPage && extractOrgSlug()) return true;

  return false;
};

/** Extract the CSRF token from the `sentry-sc` cookie for write operations */
const getCsrfToken = (): string | null => {
  const match = document.cookie.split('; ').find(c => c.startsWith('sentry-sc='));
  return match?.split('=')[1] ?? null;
};

// --- Token persistence on globalThis ---

const getPersistedAuth = (): SentryAuth | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, SentryAuth | undefined> | undefined;
    return cache?.sentry ?? null;
  } catch {
    return null;
  }
};

const setPersistedAuth = (auth: SentryAuth): void => {
  try {
    const g = globalThis as Record<string, unknown>;
    if (!g.__openTabs) g.__openTabs = {};
    const ns = g.__openTabs as Record<string, unknown>;
    if (!ns.tokenCache) ns.tokenCache = {};
    const cache = ns.tokenCache as Record<string, SentryAuth | undefined>;
    cache.sentry = auth;
  } catch {
    // Silently ignore
  }
};

const clearPersistedAuth = (): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, SentryAuth | undefined> | undefined;
    if (cache) cache.sentry = undefined;
  } catch {
    // Silently ignore
  }
};

// --- Public auth helpers ---

export const isSentryAuthenticated = (): boolean => getAuth() !== null;

export const waitForSentryAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isSentryAuthenticated()) {
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

export const getOrgSlug = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Sentry.');
  return auth.orgSlug;
};

// --- API caller ---

type QueryValue = string | number | boolean | undefined;

export const sentryApi = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, QueryValue | QueryValue[]>;
  } = {},
): Promise<T> => {
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
      clearPersistedAuth();
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
