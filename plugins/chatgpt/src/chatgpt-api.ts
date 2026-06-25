import {
  ToolError,
  fetchJSON,
  fetchFromPage,
  buildQueryString,
  getCookie,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://chatgpt.com/backend-api';
const SESSION_URL = 'https://chatgpt.com/api/auth/session';

// --- Auth ---

interface ChatGPTAuth {
  accessToken: string;
}

const fetchAccessToken = async (): Promise<string | null> => {
  try {
    const session = await fetchJSON<{
      accessToken?: string;
    }>(SESSION_URL);
    return session?.accessToken ?? null;
  } catch {
    return null;
  }
};

const getAuth = (): ChatGPTAuth | null => {
  const cached = getAuthCache<ChatGPTAuth>('chatgpt');
  if (cached) return cached;

  // The access token requires an async fetch from /api/auth/session.
  // For synchronous isAuthenticated checks, we rely on the oai-client-auth-info
  // cookie as a presence indicator — the actual token is fetched lazily on first API call.
  return null;
};

const ensureAuth = async (): Promise<ChatGPTAuth> => {
  const cached = getAuthCache<ChatGPTAuth>('chatgpt');
  if (cached) return cached;

  const accessToken = await fetchAccessToken();
  if (!accessToken) throw ToolError.auth('Not authenticated — please log in to ChatGPT.');

  const auth: ChatGPTAuth = { accessToken };
  setAuthCache('chatgpt', auth);
  return auth;
};

/** Synchronous auth presence check using the non-HttpOnly user info cookie. */
export const isAuthenticated = (): boolean => {
  if (getAuth()) return true;
  // oai-client-auth-info cookie is set for logged-in users
  const authCookie = getCookie('oai-client-auth-info');
  return authCookie !== null && authCookie.length > 0;
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- API caller ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = await ensureAuth();

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${API_BASE}${endpoint}?${qs}` : `${API_BASE}${endpoint}`;

  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
  };

  const init: FetchFromPageOptions = { method, headers };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  try {
    const data = await fetchJSON<T>(url, init);
    return data as T;
  } catch (err: unknown) {
    // On 401/403, clear cached token so it re-fetches on next call
    if (
      err instanceof ToolError &&
      (err.code === 'auth' || err.message.includes('401') || err.message.includes('403'))
    ) {
      clearAuthCache('chatgpt');
    }
    throw err;
  }
};

export const fetchChatGPTFile = async (url: string): Promise<Response> => {
  const auth = await ensureAuth();
  const response = await fetchFromPage(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
    timeout: 60_000,
  });
  return response;
};

export const chatGPTFileContentUrl = (fileId: string): string =>
  `${API_BASE}/estuary/content?id=${encodeURIComponent(fileId)}`;
