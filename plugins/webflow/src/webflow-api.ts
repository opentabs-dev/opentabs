import {
  ToolError,
  fetchJSON,
  getMetaContent,
  waitUntil,
  buildQueryString,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth detection ---
// Webflow uses HttpOnly session cookies for API auth.
// Auth is detected via the <meta name="_csrf"> tag, which is present
// only for logged-in users. The session cookie is sent automatically
// via credentials: 'include'.

interface WebflowAuth {
  csrf: string;
}

const getAuth = (): WebflowAuth | null => {
  const cached = getAuthCache<WebflowAuth>('webflow');
  if (cached) return cached;

  const csrf = getMetaContent('_csrf');
  if (!csrf) return null;

  const auth: WebflowAuth = { csrf };
  setAuthCache('webflow', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- API caller ---
// Webflow's internal API is same-origin at /api/. All endpoints use
// HttpOnly session cookies sent automatically with credentials: 'include'.

const API_BASE = '/api';

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Webflow.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  const headers: Record<string, string> = {};

  const init: FetchFromPageOptions = {
    method: options.method ?? 'GET',
    headers,
  };

  if (init.method !== 'GET') {
    headers['X-CSRF-Token'] = auth.csrf;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  try {
    const data = await fetchJSON<T>(url, init);
    return data as T;
  } catch (err: unknown) {
    // On 401/403/412, clear auth cache to force re-read
    if (err instanceof ToolError && (err.category === 'auth' || err.code === '412')) {
      clearAuthCache('webflow');
    }
    throw err;
  }
};
