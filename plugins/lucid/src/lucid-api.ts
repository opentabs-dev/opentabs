import { ToolError, fetchJSON, fetchFromPage, buildQueryString, getCookie } from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth detection ---

interface LucidAuth {
  userId: string;
  accountId: string;
}

const getAuth = (): LucidAuth | null => {
  const userId = getCookie('userId');
  const accountId = getCookie('account_id');
  if (!userId || !accountId) return null;
  return { userId, accountId };
};

export const isAuthenticated = (): boolean => getAuth() !== null;

const requireAuth = (): LucidAuth => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Lucid.');
  return auth;
};

export const getUserId = (): string => requireAuth().userId;
export const getAccountId = (): string => requireAuth().accountId;

// --- API helpers ---

const USERS_API = 'https://users.lucid.app';
const DOCS_API = 'https://documents.lucid.app';
const DOCLIST_API = 'https://userdocslist.lucid.app';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const lucidFetch = async <T>(
  baseUrl: string,
  path: string,
  options: {
    method?: HttpMethod;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  requireAuth();

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const init: FetchFromPageOptions = { method, headers };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  if (method === 'DELETE') {
    const response = await fetchFromPage(url, init);
    if (response.status === 204) return {} as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  const data = await fetchJSON<T>(url, init);
  if (data === undefined) throw ToolError.internal('Empty response from Lucid API');
  return data;
};

// --- Domain-specific API callers ---

export const usersApi = <T>(
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => lucidFetch<T>(USERS_API, path, options);

export const docsApi = <T>(
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => lucidFetch<T>(DOCS_API, path, options);

export const docListApi = <T>(
  path: string,
  options?: {
    method?: HttpMethod;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> => lucidFetch<T>(DOCLIST_API, path, options);
