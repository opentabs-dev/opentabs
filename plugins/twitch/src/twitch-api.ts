import {
  ToolError,
  fetchFromPage,
  getCookie,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const GQL_URL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

interface TwitchAuth {
  token: string;
  userId: string;
  login: string;
}

const getAuth = (): TwitchAuth | null => {
  const cached = getAuthCache<TwitchAuth>('twitch');
  if (cached) return cached;

  const token = getCookie('auth-token');
  if (!token) return null;

  // twilight-user cookie has user info as URL-encoded JSON
  let userId = '';
  let login = '';
  const twilightUser = getCookie('twilight-user');
  if (twilightUser) {
    try {
      const parsed = JSON.parse(decodeURIComponent(twilightUser));
      userId = parsed.id ?? '';
      login = parsed.login ?? '';
    } catch {
      // ignore parse errors
    }
  }

  const auth: TwitchAuth = { token, userId, login };
  setAuthCache('twitch', auth);
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

export const getUserId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Twitch.');
  return auth.userId;
};

export const getLogin = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Twitch.');
  return auth.login;
};

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
  extensions?: { durationMilliseconds?: number };
}

export const gql = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Twitch.');

  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;

  // gql.twitch.tv uses Access-Control-Allow-Origin: * which is incompatible with
  // credentials:'include'. Auth is via the OAuth header, not cookies.
  let response: Response;
  try {
    response = await fetchFromPage(GQL_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Client-Id': CLIENT_ID,
        Authorization: `OAuth ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ToolError && error.category === 'auth') {
      clearAuthCache('twitch');
    }
    throw error;
  }

  const result = (await response.json()) as GqlResponse<T>;

  // GraphQL can return both data and errors — only throw if there's no data
  if (result.errors?.length && !result.data) {
    const msg = result.errors.map(e => e.message).join('; ');
    if (msg.includes('failed integrity check')) {
      throw ToolError.auth(
        'This operation requires Twitch integrity verification and cannot be performed via the plugin.',
      );
    }
    throw ToolError.internal(`Twitch GQL error: ${msg}`);
  }

  if (!result.data) {
    throw ToolError.internal('Twitch GQL returned no data');
  }

  return result.data;
};
