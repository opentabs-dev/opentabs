import {
  type FetchFromPageOptions,
  ToolError,
  buildQueryString,
  clearAuthCache,
  fetchFromPage,
  getAuthCache,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

const PUBLIC_API = 'https://api.spotify.com/v1';
const GRAPHQL_API = 'https://api-partner.spotify.com/pathfinder/v2/query';

interface SpotifyAuth {
  token: string;
}

// --- Fetch interception for bearer token ---

let interceptorInstalled = false;

const installInterceptor = (): void => {
  if (typeof window === 'undefined') return;

  const origFetch = (globalThis as Record<string, unknown>).__spotifyOrigFetch as typeof fetch | undefined;
  if (origFetch && interceptorInstalled) return;

  const realFetch = origFetch ?? window.fetch;
  (globalThis as Record<string, unknown>).__spotifyOrigFetch = realFetch;

  window.fetch = function (...args: Parameters<typeof fetch>) {
    const [, opts] = args;
    if (opts?.headers) {
      let auth: string | null = null;
      if (opts.headers instanceof Headers) {
        auth = opts.headers.get('Authorization') ?? opts.headers.get('authorization');
      } else if (typeof opts.headers === 'object' && !Array.isArray(opts.headers)) {
        const h = opts.headers as Record<string, string>;
        auth = h.Authorization ?? h.authorization ?? null;
      }
      if (auth?.startsWith('Bearer ')) {
        const token = auth.slice(7);
        setAuthCache<SpotifyAuth>('spotify', { token });
      }
    }
    return realFetch.apply(this, args);
  };

  interceptorInstalled = true;
};

installInterceptor();

export const resetInterceptor = (): void => {
  if (typeof window === 'undefined') return;

  const origFetch = (globalThis as Record<string, unknown>).__spotifyOrigFetch as typeof fetch | undefined;
  if (!origFetch) return;

  window.fetch = origFetch;
  delete (globalThis as Record<string, unknown>).__spotifyOrigFetch;
  interceptorInstalled = false;
};

const getAuth = (): SpotifyAuth | null => {
  return getAuthCache<SpotifyAuth>('spotify');
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 });
    return true;
  } catch {
    return false;
  }
};

// --- GraphQL persisted query hashes ---
// These hashes correspond to Spotify's internal persisted queries. They change
// when Spotify deploys a new client version. If a hash expires, the API returns
// PERSISTED_QUERY_NOT_FOUND and the plugin needs rebuilding with updated hashes.

const OPERATION_HASHES: Record<string, string> = {
  profileAttributes: '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  accountAttributes: '24aaa3057b69fa91492de26841ad199bd0b330ca95817b7a4d6715150de01827',
  searchDesktop: '3c9d3f60dac5dea3876b6db3f534192b1c1d90032c4233c1bbaba526db41eb31',
  queryArtistOverview: 'dd14c6043d8127b56c5acbe534f6b3c58714f0c26bc6ad41776079ed52833a8f',
  getAlbum: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
  fetchPlaylist: '9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f',
  fetchLibraryTracks: '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  home: '3e8e118c033b10353783ec0404451de66ed44e5cb5e0caefc65e4fab7b9e0aef',
  areEntitiesInLibrary: '134337999233cc6fdd6b91dfe4f4e1cf0b04cd0beb56d11ebc3e54abf3a26b23',
};

// --- GraphQL caller (internal API, no rate limits) ---

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

export const graphql = async <T>(operationName: string, variables: Record<string, unknown> = {}): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Spotify.');

  const hash = OPERATION_HASHES[operationName];
  if (!hash) throw ToolError.internal(`Unknown GraphQL operation: ${operationName}`);

  const response = await fetchFromPage(GRAPHQL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json;charset=UTF-8',
      'app-platform': 'WebPlayer',
      accept: 'application/json',
    },
    credentials: 'omit',
    body: JSON.stringify({
      variables,
      operationName,
      extensions: {
        persistedQuery: { version: 1, sha256Hash: hash },
      },
    }),
  });

  const json = (await response.json()) as { data?: T; errors?: GraphQLError[] };

  if (json.errors?.some(e => e.extensions?.code === 'PERSISTED_QUERY_NOT_FOUND')) {
    throw ToolError.internal(
      `Persisted query hash expired for "${operationName}" — Spotify deployed a new client version. ` +
        'The plugin needs to be rebuilt with updated hashes.',
    );
  }

  if (json.errors?.length && !json.data) {
    const msg = json.errors.map(e => e.message).join('; ');
    throw ToolError.internal(`GraphQL error: ${msg}`);
  }

  return json.data as T;
};

// --- Public API caller (used for playback control endpoints) ---
// Playback control endpoints (PUT/POST to /me/player/*) use a separate rate
// limit pool from data-read endpoints and generally work on free-tier accounts.

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Spotify.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${PUBLIC_API}${endpoint}?${qs}` : `${PUBLIC_API}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  const method = options.method ?? 'GET';

  const init: FetchFromPageOptions = { method, headers, credentials: 'omit' };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchFromPage(url, init);
  } catch (e: unknown) {
    if (e instanceof ToolError && e.category === 'auth') {
      clearAuthCache('spotify');
    }
    throw e;
  }

  if (response.status === 204 || response.status === 202) {
    return {} as T;
  }

  return (await response.json()) as T;
};
