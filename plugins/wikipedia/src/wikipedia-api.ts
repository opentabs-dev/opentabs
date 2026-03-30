import {
  ToolError,
  fetchJSON,
  getPageGlobal,
  buildQueryString,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth detection ---
// Wikipedia uses HttpOnly session cookies for API auth.
// Auth state is detected via the MediaWiki JS config object (mw.config).

interface WikiAuth {
  username: string;
  userId: number;
}

const getAuth = (): WikiAuth | null => {
  const cached = getAuthCache<WikiAuth>('wikipedia');
  if (cached) return cached;

  const username = getPageGlobal('mw.config.values.wgUserName') as string | null | undefined;
  const userId = getPageGlobal('mw.config.values.wgUserId') as number | null | undefined;

  if (!username || !userId) return null;

  const auth: WikiAuth = { username, userId };
  setAuthCache('wikipedia', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const isPageReady = (): boolean => getPageGlobal('mw.config.values.wgSiteName') !== undefined;

export const waitForReady = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isPageReady(), { interval: 300, timeout: 5000 });
    return true;
  } catch {
    return isPageReady();
  }
};

// --- MediaWiki API caller ---
// All API calls go to /w/api.php with format=json.
// Session cookies are included automatically by fetchJSON.

const API_PATH = '/w/api.php';

export const api = async <T>(
  params: Record<string, string | number | boolean | undefined>,
  options?: { method?: string; requireAuth?: boolean },
): Promise<T> => {
  const method = options?.method ?? 'GET';

  if (options?.requireAuth && !isAuthenticated()) {
    throw ToolError.auth('Not logged in to Wikipedia — please log in first.');
  }

  const allParams: Record<string, string | number | boolean | undefined> = {
    ...params,
    format: 'json',
    formatversion: 2,
  };

  let data: unknown;

  if (method === 'GET') {
    const qs = buildQueryString(allParams);
    data = await fetchJSON<Record<string, unknown>>(`${API_PATH}?${qs}`);
  } else {
    // POST requests: send params as form-encoded body
    const formBody = buildQueryString(allParams);
    const init: FetchFromPageOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    };
    data = await fetchJSON<Record<string, unknown>>(API_PATH, init);
  }

  // MediaWiki returns application-level errors with HTTP 200
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error: { code?: string; info?: string } }).error;
    const code = err.code ?? 'unknown';
    const info = err.info ?? 'Unknown MediaWiki error';
    if (code === 'badtoken' || code === 'assertuserfailed') throw ToolError.auth(info);
    if (code === 'missingtitle' || code === 'nosuchpageid') throw ToolError.notFound(info);
    if (code === 'ratelimited') throw ToolError.rateLimited(info);
    throw ToolError.internal(`MediaWiki error [${code}]: ${info}`);
  }

  return data as T;
};
