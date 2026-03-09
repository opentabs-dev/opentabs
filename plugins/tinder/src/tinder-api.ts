import {
  type FetchFromPageOptions,
  ToolError,
  buildQueryString,
  clearAuthCache,
  fetchFromPage,
  getAuthCache,
  getLocalStorage,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://api.gotinder.com';

interface TinderAuth {
  token: string;
  deviceId: string;
}

const getAuth = (): TinderAuth | null => {
  const cached = getAuthCache<TinderAuth>('tinder');
  if (cached) return cached;

  const token = getLocalStorage('TinderWeb/APIToken');
  if (!token) return null;

  const deviceId = getLocalStorage('TinderWeb/uuid') ?? '';
  const auth: TinderAuth = { token, deviceId };
  setAuthCache('tinder', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

/** Build the standard headers required by all Tinder API calls. */
const buildHeaders = (auth: TinderAuth): Record<string, string> => ({
  'X-Auth-Token': auth.token,
  platform: 'web',
  'app-version': '1070700',
  'tinder-version': '7.7.0',
  'persistent-device-id': auth.deviceId,
  'x-supported-image-formats': 'webp,jpeg',
});

/**
 * Tinder API caller. Handles auth token injection and error classification.
 *
 * The Tinder API is cross-origin (api.gotinder.com from tinder.com), so auth
 * is via the `X-Auth-Token` header, not cookies. Additional headers
 * (`app-version`, `tinder-version`, `persistent-device-id`) are required by
 * some endpoints (e.g., `/v2/recs/core`).
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Tinder.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  const method = options.method ?? 'GET';

  const headers = buildHeaders(auth);

  const init: FetchFromPageOptions = {
    method,
    headers,
    credentials: 'omit',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchFromPage(url, init);
  } catch (error: unknown) {
    if (error instanceof ToolError) {
      // On 401, clear cached auth so it re-reads from localStorage on next call
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        clearAuthCache('tinder');
      }
      throw error;
    }
    throw ToolError.internal(`Tinder API error: ${String(error)}`);
  }

  if (response.status === 204) return {} as T;

  const data = await response.json();
  return data as T;
};

/**
 * Some Tinder endpoints (like/pass) use GET without Content-Type
 * and return the response directly (not wrapped in {meta,data}).
 */
export const apiDirect = async <T>(
  endpoint: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Tinder.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  const headers = buildHeaders(auth);

  let response: Response;
  try {
    response = await fetchFromPage(url, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'omit',
    });
  } catch (error: unknown) {
    if (error instanceof ToolError) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        clearAuthCache('tinder');
      }
      throw error;
    }
    throw ToolError.internal(`Tinder API error: ${String(error)}`);
  }

  if (response.status === 204) return {} as T;

  const data = await response.json();
  return data as T;
};
