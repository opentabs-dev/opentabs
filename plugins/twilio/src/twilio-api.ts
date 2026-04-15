import {
  type FetchFromPageOptions,
  ToolError,
  buildQueryString,
  fetchFromPage,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Auth ---

interface TwilioAuth {
  accountSid: string;
  authToken: string;
}

const fetchProjectInfo = async (): Promise<TwilioAuth | null> => {
  try {
    const resp = await fetchFromPage('https://www.twilio.com/console/api/v2/projects/info', {
      method: 'GET',
    });
    const data = (await resp.json()) as { projectSid?: string; authToken?: string };
    if (data.projectSid && data.authToken) {
      return { accountSid: data.projectSid, authToken: data.authToken };
    }
    return null;
  } catch (e: unknown) {
    if (e instanceof ToolError) throw e;
    return null;
  }
};

const getAuth = (): TwilioAuth | null => {
  const cached = getAuthCache<TwilioAuth>('twilio');
  if (cached?.accountSid && cached.authToken) return cached;
  return null;
};

const ensureAuth = async (): Promise<TwilioAuth> => {
  const cached = getAuth();
  if (cached) return cached;

  const auth = await fetchProjectInfo();
  if (auth) {
    setAuthCache('twilio', auth);
    return auth;
  }
  throw ToolError.auth('Not authenticated — please log in to Twilio Console.');
};

export const isAuthenticated = (): boolean => {
  return getAuth() !== null;
};

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
};

// --- API callers ---

const buildBasicAuth = (auth: TwilioAuth): string => {
  return btoa(`${auth.accountSid}:${auth.authToken}`);
};

/**
 * Call the Twilio REST API (api.twilio.com).
 * Uses Basic Auth with Account SID + Auth Token.
 * Twilio POST/PUT bodies use application/x-www-form-urlencoded.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    baseUrl?: string;
  } = {},
): Promise<T> => {
  const auth = await ensureAuth();
  const method = options.method ?? 'GET';
  const baseUrl = options.baseUrl ?? `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}`;

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${baseUrl}${endpoint}?${qs}` : `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Basic ${buildBasicAuth(auth)}`,
  };

  const init: FetchFromPageOptions = {
    method,
    headers,
    credentials: 'omit',
  };

  if (options.body && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(options.body).toString();
  }

  const response = await fetchFromPage(url, init);

  if (response.status === 204) return {} as T;

  const data = await response.json();
  return data as T;
};

/**
 * Call a Twilio sub-product API (verify, messaging, monitor, etc.).
 */
export const subApi = async <T>(
  baseUrl: string,
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  return api<T>(endpoint, { ...options, baseUrl });
};
