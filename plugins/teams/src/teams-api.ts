import {
  ToolError,
  findLocalStorageEntry,
  getPreScriptValue,
  parseRetryAfterMs,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

type TeamsEnvironment = 'consumer' | 'enterprise';

/** Detect whether we are running on consumer or enterprise Teams. */
const detectEnvironment = (): TeamsEnvironment => {
  try {
    if (typeof window !== 'undefined' && window.location.hostname === 'teams.live.com') {
      return 'consumer';
    }
  } catch {
    // Fall through to enterprise default
  }
  return 'enterprise';
};

interface EnvConfig {
  authzUrl: string;
  chatServiceBase: string | null; // null = discover from localStorage
}

const CONSUMER_CONFIG: EnvConfig = {
  authzUrl: 'https://teams.live.com/api/auth/v1.0/authz/consumer',
  chatServiceBase: 'https://teams.live.com/api/chatsvc/consumer',
};

const ENTERPRISE_CONFIG: EnvConfig = {
  authzUrl: 'https://teams.microsoft.com/api/authsvc/v1.0/authz',
  chatServiceBase: null, // Discovered at runtime from regionGtms
};

const getConfig = (): EnvConfig => {
  return detectEnvironment() === 'consumer' ? CONSUMER_CONFIG : ENTERPRISE_CONFIG;
};

// ---------------------------------------------------------------------------
// Skype API access token (captured by pre-script)
// ---------------------------------------------------------------------------

interface CapturedToken {
  secret: string;
  expiresOn: number;
}

/**
 * Read a value the pre-script stashed under the `teams` plugin namespace.
 *
 * `getPreScriptValue` from the SDK depends on `globalThis.__openTabs._pluginName`
 * being bound, but the adapter IIFE only binds that during tool dispatch —
 * `isReady()` runs before any tool is dispatched, so the SDK helper would
 * return `undefined` there. We try the SDK helper first (which gives
 * forward-compat with any future SDK changes), then fall back to a direct
 * namespace read against the documented path.
 */
const readPreScriptValue = <T>(key: string): T | undefined => {
  const viaSdk = getPreScriptValue<T>(key);
  if (viaSdk !== undefined) return viaSdk;
  const ns = (globalThis as { __openTabs?: { preScript?: Record<string, Record<string, unknown>> } }).__openTabs
    ?.preScript?.teams;
  return ns?.[key] as T | undefined;
};

/**
 * Read the MSAL-issued Skype API access token captured by the pre-script.
 * The pre-script (plugins/teams/src/pre-script.ts) observes MSAL cache
 * writes via `Storage.prototype.setItem` and an initial `localStorage`
 * scan, recognising entries by their value shape (`credentialType`,
 * `target`, `secret`, `expiresOn`). The adapter only reads the captured
 * value here — it never inspects MSAL key shapes, so the path is
 * resilient to future MSAL cache key layout changes.
 */
const getSkypeAccessToken = (): string | null => {
  const key = detectEnvironment() === 'consumer' ? 'consumerToken' : 'enterpriseToken';
  const captured = readPreScriptValue<CapturedToken>(key);
  if (!captured || typeof captured.secret !== 'string' || captured.secret.length === 0) {
    return null;
  }
  if (typeof captured.expiresOn !== 'number' || captured.expiresOn <= Date.now() / 1000) {
    return null;
  }
  return captured.secret;
};

// ---------------------------------------------------------------------------
// Enterprise chat service URL discovery
// ---------------------------------------------------------------------------

/** Cached enterprise chat service URL. */
let cachedEnterpriseChatServiceBase: string | null = null;

/**
 * Discover the enterprise chat service URL from the regionGtms data stored
 * in localStorage by the Teams SPA. Falls back to the AFD proxy URL.
 */
const discoverEnterpriseChatServiceBase = (): string => {
  if (cachedEnterpriseChatServiceBase) return cachedEnterpriseChatServiceBase;

  const entry = findLocalStorageEntry(key => key.includes('Discover.SKYPE-TOKEN'));
  if (entry) {
    try {
      const data = JSON.parse(entry.value) as {
        item?: { regionGtms?: { chatService?: string; chatServiceAfd?: string } };
      };
      const chatService = data.item?.regionGtms?.chatService;
      if (chatService) {
        cachedEnterpriseChatServiceBase = chatService;
        return chatService;
      }
      const chatServiceAfd = data.item?.regionGtms?.chatServiceAfd;
      if (chatServiceAfd) {
        cachedEnterpriseChatServiceBase = chatServiceAfd;
        return chatServiceAfd;
      }
    } catch {
      // Fall through to default
    }
  }

  // Default fallback — AMER region AFD proxy
  return 'https://teams.microsoft.com/api/chatsvc/amer';
};

/** Get the chat service base URL for the current environment. */
const getChatServiceBase = (): string => {
  const config = getConfig();
  return config.chatServiceBase ?? discoverEnterpriseChatServiceBase();
};

// ---------------------------------------------------------------------------
// Skype JWT exchange
// ---------------------------------------------------------------------------

/** Cached Skype JWT and its expiration time in milliseconds. */
let cachedSkypeJwt: { token: string; expiresAt: number } | null = null;

/**
 * Exchange the MSAL Skype API token for a Skype JWT via the authz endpoint.
 * Works for both consumer and enterprise environments.
 * The JWT is cached until 60 seconds before expiration.
 */
const getSkypeJwt = async (): Promise<string> => {
  if (cachedSkypeJwt && Date.now() < cachedSkypeJwt.expiresAt - 60_000) {
    return cachedSkypeJwt.token;
  }

  const config = getConfig();
  const accessToken = getSkypeAccessToken();
  if (!accessToken) {
    const env = detectEnvironment();
    throw ToolError.auth(
      `Not authenticated — no Skype API access token captured for ${env} Teams. If you just installed this plugin, reload the Teams tab so the pre-script can intercept the token.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(config.authzUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Skype JWT exchange timed out');
    }
    throw ToolError.internal(`Skype JWT exchange failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      cachedSkypeJwt = null;
      throw ToolError.auth(`Skype JWT exchange auth error (${String(response.status)}): ${body.substring(0, 256)}`);
    }
    throw ToolError.internal(`Skype JWT exchange error (${String(response.status)}): ${body.substring(0, 256)}`);
  }

  const data = (await response.json()) as {
    // Consumer format: { skypeToken: { skypetoken, expiresIn } }
    skypeToken?: { skypetoken?: string; expiresIn?: number };
    // Enterprise format: { tokens: { skypeToken, expiresIn } }
    tokens?: { skypeToken?: string; expiresIn?: number };
  };

  // Enterprise returns the JWT in tokens.skypeToken (string);
  // consumer returns it in skypeToken.skypetoken (nested object).
  const jwt = data.tokens?.skypeToken ?? data.skypeToken?.skypetoken;
  if (!jwt) {
    throw ToolError.internal('Skype JWT exchange returned empty token');
  }

  const expiresIn = data.tokens?.expiresIn ?? data.skypeToken?.expiresIn ?? 3600;
  cachedSkypeJwt = { token: jwt, expiresAt: Date.now() + expiresIn * 1000 };
  return jwt;
};

// ---------------------------------------------------------------------------
// Current user identity
// ---------------------------------------------------------------------------

interface SkypeIdentity {
  skypeid: string;
  signinname: string;
}

/**
 * Decode a JWT payload without verification (we only need to read claims).
 */
const decodeJwtPayload = (jwt: string): Record<string, unknown> => {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  try {
    // base64url payloads are emitted without `=` padding; restore it before
    // calling atob, which throws InvalidCharacterError on lengths not
    // divisible by 4.
    const raw = parts[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/**
 * Read the sign-in email captured by the pre-script. The pre-script
 * decodes the MSAL ID token's JWT and stashes
 * `preferred_username` / `upn` / `email` under `signInName`.
 * Enterprise authz responses do not include the email, so we depend on
 * the ID token claims for it.
 */
const findSignInName = (): string => readPreScriptValue<string>('signInName') ?? '';

/**
 * Get the current user's Skype identity (MRI and sign-in email) by performing
 * a Skype JWT exchange and reading the identity fields from the response.
 * On enterprise, identity is extracted from the JWT payload and MSAL ID token.
 */
export const getSkypeIdentity = async (): Promise<SkypeIdentity> => {
  const config = getConfig();
  const accessToken = getSkypeAccessToken();
  if (!accessToken) {
    const env = detectEnvironment();
    throw ToolError.auth(
      `Not authenticated — no Skype API access token captured for ${env} Teams. If you just installed this plugin, reload the Teams tab so the pre-script can intercept the token.`,
    );
  }

  const response = await fetch(config.authzUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw ToolError.auth(`Failed to get identity: HTTP ${String(response.status)}`);
  }

  const data = (await response.json()) as {
    // Consumer format
    skypeToken?: { skypeid?: string; signinname?: string; skypetoken?: string };
    // Enterprise format
    tokens?: { skypeToken?: string };
  };

  // Consumer returns identity directly in the response
  if (data.skypeToken?.skypeid) {
    return {
      skypeid: data.skypeToken.skypeid,
      signinname: data.skypeToken.signinname ?? '',
    };
  }

  // Enterprise: decode the JWT to get skypeid, and read email from MSAL ID token
  const jwt = data.tokens?.skypeToken ?? data.skypeToken?.skypetoken ?? '';
  const claims = jwt ? decodeJwtPayload(jwt) : {};
  return {
    skypeid: String(claims.skypeid ?? ''),
    signinname: findSignInName(),
  };
};

// ---------------------------------------------------------------------------
// Authentication detection
// ---------------------------------------------------------------------------

export const isTeamsAuthenticated = (): boolean => getSkypeAccessToken() !== null;

/**
 * Wait for the pre-script to capture the Skype API access token. On a
 * tab where MSAL has already cached the token, the initial localStorage
 * scan in the pre-script captures it synchronously at document_start;
 * on a fresh login it lands as soon as MSAL writes the cache entry.
 * Polls at 500ms intervals for up to 8 seconds.
 */
export const waitForTeamsAuth = (): Promise<boolean> =>
  waitUntil(() => isTeamsAuthenticated(), { interval: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );

// ---------------------------------------------------------------------------
// Chat Service API
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the Teams Chat Service (Skype-based API).
 * Uses the Skype JWT obtained via MSAL token exchange.
 * Automatically routes to the correct endpoint for consumer or enterprise.
 */
export const chatApi = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const skypeJwt = await getSkypeJwt();
  const chatServiceBase = getChatServiceBase();
  const { method = 'GET', body, query } = options;

  let url = `${chatServiceBase}${endpoint}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authentication: `skypetoken=${skypeJwt}`,
    'Content-Type': 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`Teams Chat API timed out: ${method} ${endpoint}`);
    }
    throw ToolError.internal(
      `Network error calling Teams Chat API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return handleApiResponse<T>(response, method, endpoint);
};

/**
 * Create a chat thread via the Chat Service. Returns the thread ID extracted
 * from the Location response header.
 */
export const createThread = async (
  members: Array<{ id: string; role: string }>,
  properties?: Record<string, unknown>,
): Promise<string> => {
  const skypeJwt = await getSkypeJwt();
  const chatServiceBase = getChatServiceBase();

  const body: Record<string, unknown> = { members };
  if (properties) body.properties = properties;

  let response: Response;
  try {
    response = await fetch(`${chatServiceBase}/v1/threads`, {
      method: 'POST',
      headers: {
        Authentication: `skypetoken=${skypeJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Teams create thread timed out');
    }
    throw ToolError.internal(`Network error creating thread: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    classifyHttpError(response.status, errorText, 'POST', '/v1/threads', response.headers);
  }

  const location = response.headers.get('Location') ?? '';
  const threadId = location.split('/threads/').pop() ?? '';
  if (!threadId) {
    throw ToolError.internal('Thread created but no thread ID returned in Location header');
  }
  return threadId;
};

/**
 * Make an authenticated request to a thread-level endpoint
 * (`/v1/threads/{threadId}/...`). Used for member management and
 * property updates on existing threads.
 */
export const threadApi = async <T>(
  threadId: string,
  subpath: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> => {
  const skypeJwt = await getSkypeJwt();
  const chatServiceBase = getChatServiceBase();
  const { method = 'GET', body } = options;
  const url = `${chatServiceBase}/v1/threads/${encodeURIComponent(threadId)}${subpath}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authentication: `skypetoken=${skypeJwt}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`Teams thread API timed out: ${method} ${subpath}`);
    }
    throw ToolError.internal(
      `Network error calling Teams thread API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return handleApiResponse<T>(response, method, subpath);
};

// ---------------------------------------------------------------------------
// Shared response handling
// ---------------------------------------------------------------------------

const handleApiResponse = async <T>(response: Response, method: string, endpoint: string): Promise<T> => {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    classifyHttpError(response.status, errorText, method, endpoint, response.headers);
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return {} as T;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw ToolError.internal(`Teams API returned invalid JSON: ${method} ${endpoint}`);
  }

  return data as T;
};

/** Clear all module-level caches so the next API call re-discovers fresh values. */
export const clearCaches = (): void => {
  cachedEnterpriseChatServiceBase = null;
  cachedSkypeJwt = null;
};

/** Classify HTTP errors into ToolError categories. Always throws. */
const classifyHttpError = (
  status: number,
  errorText: string,
  method: string,
  endpoint: string,
  headers: Headers,
): never => {
  const errorBody = errorText.substring(0, 512);

  if (status === 429) {
    const retryAfterHeader = headers.get('Retry-After');
    const retryMs = retryAfterHeader !== null ? parseRetryAfterMs(retryAfterHeader) : undefined;
    throw ToolError.rateLimited(`Teams API rate limited: ${method} ${endpoint} — ${errorBody}`, retryMs);
  }
  if (status === 401 || status === 403) {
    cachedSkypeJwt = null;
    throw ToolError.auth(`Teams API auth error (${String(status)}): ${errorBody}`);
  }
  if (status === 404) {
    throw ToolError.notFound(`Teams API not found: ${method} ${endpoint} — ${errorBody}`);
  }
  if (status === 400) {
    throw ToolError.validation(`Teams API bad request: ${method} ${endpoint} — ${errorBody}`);
  }
  throw ToolError.internal(`Teams API error (${String(status)}): ${method} ${endpoint} — ${errorBody}`);
};
