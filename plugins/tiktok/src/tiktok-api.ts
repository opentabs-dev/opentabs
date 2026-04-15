import {
  ToolError,
  fetchFromPage,
  buildQueryString,
  getPageGlobal,
  getCookie,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { RawSSRUser } from './tools/schemas.js';

// --- Types ---

interface TikTokAuth {
  uid: string;
  secUid: string;
  uniqueId: string;
  nickname: string;
  csrfToken: string;
}

interface RehydrationAppContext {
  user?: {
    uid?: string;
    secUid?: string;
    uniqueId?: string;
    nickName?: string;
  };
  csrfToken?: string;
}

// --- Auth ---

const getRehydrationData = (): Record<string, unknown> | null => {
  if (typeof document === 'undefined') return null;
  const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getAppContext = (): RehydrationAppContext | null => {
  const data = getRehydrationData();
  if (!data) return null;
  const scope = data.__DEFAULT_SCOPE__ as Record<string, unknown> | undefined;
  return (scope?.['webapp.app-context'] as RehydrationAppContext) ?? null;
};

const getAuth = (): TikTokAuth | null => {
  const cached = getAuthCache<TikTokAuth>('tiktok');
  if (cached) return cached;

  const ctx = getAppContext();
  const user = ctx?.user;
  if (!user?.uid) return null;

  const csrfToken = ctx?.csrfToken ?? getCookie('tt_csrf_token') ?? '';

  const auth: TikTokAuth = {
    uid: user.uid,
    secUid: user.secUid ?? '',
    uniqueId: user.uniqueId ?? '',
    nickname: user.nickName ?? '',
    csrfToken,
  };
  setAuthCache('tiktok', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), {
      interval: 500,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
};

export const getCurrentAuth = (): TikTokAuth => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to TikTok.');
  return auth;
};

// --- Signing ---

interface AcrawlerInstance {
  frontierSign: (url: string) => Promise<{ 'X-Bogus'?: string }>;
}

const getAcrawler = (): AcrawlerInstance | null => getPageGlobal('byted_acrawler') as AcrawlerInstance | null;

const signUrl = async (url: string): Promise<string> => {
  const acrawler = getAcrawler();
  if (!acrawler) return url;
  try {
    const result = await acrawler.frontierSign(url);
    const bogus = result['X-Bogus'];
    if (bogus) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}X-Bogus=${bogus}`;
    }
  } catch {
    // Signing failed — proceed without it
  }
  return url;
};

// --- Common query params ---

const BASE_PARAMS: Record<string, string | number | boolean> = {
  aid: 1988,
  app_language: 'en',
  app_name: 'tiktok_web',
  device_platform: 'web_pc',
};

// --- Helpers ---

export const normalizeUsername = (username: string): string => username.replace(/^@/, '');

// --- Signed API ---

export const api = async <T>(
  endpoint: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to TikTok.');

  const qs = buildQueryString({ ...BASE_PARAMS, ...query });
  const baseUrl = `/api${endpoint}?${qs}`;
  const url = await signUrl(baseUrl);

  const response = await fetchFromPage(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 204) return {} as T;
  const text = await response.text();
  if (text.length === 0) {
    throw ToolError.internal('TikTok returned an empty response — the endpoint may require additional signing.');
  }
  return JSON.parse(text) as T;
};

// --- SSR page fetch ---

interface SSRScope {
  [key: string]: unknown;
}

export const fetchSSRData = async (path: string): Promise<SSRScope> => {
  const url = `https://www.tiktok.com${path}`;
  const response = await fetchFromPage(url, {
    method: 'GET',
    headers: { accept: 'text/html' },
  });

  const html = await response.text();
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw ToolError.internal('Failed to extract SSR data from TikTok page.');
  }

  const data = JSON.parse(match[1]) as {
    __DEFAULT_SCOPE__?: SSRScope;
  };
  const scope = data.__DEFAULT_SCOPE__;
  if (!scope) {
    throw ToolError.internal('No __DEFAULT_SCOPE__ in SSR data.');
  }
  return scope;
};

// --- SSR user detail extraction ---

interface SSRUserDetail {
  userInfo?: {
    user?: RawSSRUser;
    stats?: import('./tools/schemas.js').RawUserStats;
  };
  statusCode?: number;
}

export const extractUserDetail = (scope: SSRScope): SSRUserDetail | undefined =>
  scope['webapp.user-detail'] as SSRUserDetail | undefined;

// --- Resolve username to secUid ---

export const resolveSecUid = async (username: string): Promise<string> => {
  const normalized = normalizeUsername(username);
  const scope = await fetchSSRData(`/@${normalized}`);
  const detail = extractUserDetail(scope);
  const secUid = detail?.userInfo?.user?.secUid;
  if (!secUid) {
    throw ToolError.notFound(`User @${normalized} not found.`);
  }
  return secUid;
};
