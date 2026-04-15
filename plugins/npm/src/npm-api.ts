import {
  ToolError,
  fetchFromPage,
  getPageGlobal,
  getAuthCache,
  setAuthCache,
  waitUntil,
  buildQueryString,
} from '@opentabs-dev/plugin-sdk';

// --- Auth ---

interface NpmAuth {
  username: string;
  csrftoken: string;
}

const getAuth = (): NpmAuth | null => {
  const cached = getAuthCache<NpmAuth>('npm');
  if (cached) return cached;

  const username = getPageGlobal('__context__.context.user.name') as string | undefined;
  const csrftoken = getPageGlobal('__context__.context.csrftoken') as string | undefined;

  if (!username || !csrftoken) return null;

  const auth: NpmAuth = { username, csrftoken };
  setAuthCache('npm', auth);
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

export const getUsername = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to npm.');
  return auth.username;
};

// --- Spiferack API ---
// The npmjs.com website returns JSON for any page when the `x-spiferack: 1` header is set.

export const spiferack = async <T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${path}?${qs}` : path;

  const headers: Record<string, string> = {
    'x-spiferack': '1',
  };

  const method = options.method ?? 'GET';

  if (method !== 'GET') {
    const auth = getAuth();
    if (!auth) throw ToolError.auth('Not authenticated — please log in to npm.');
    headers['x-csrf-token'] = auth.csrftoken;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetchFromPage(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
