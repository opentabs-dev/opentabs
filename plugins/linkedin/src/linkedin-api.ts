import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

const VOYAGER_BASE = '/voyager/api';
const MESSAGING_GRAPHQL_BASE = '/voyager/api/voyagerMessagingGraphQL/graphql';

/**
 * LinkedIn uses the JSESSIONID cookie value as the CSRF token.
 * The cookie is non-HttpOnly and accessible via document.cookie.
 */
const getCsrfToken = (): string | null => {
  const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return match?.[1] ?? null;
};

export const isAuthenticated = (): boolean => getCsrfToken() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 500;
      if (isAuthenticated()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= 5000) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });

const getHeaders = (): Record<string, string> => {
  const csrf = getCsrfToken();
  if (!csrf) throw ToolError.auth('Not authenticated — please log in to LinkedIn.');
  return {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.42665',
      mpVersion: '1.13.42665',
      osName: 'web',
      timezoneOffset: new Date().getTimezoneOffset() / -60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
      displayDensity: window.devicePixelRatio,
      displayWidth: window.screen.width,
      displayHeight: window.screen.height,
    }),
  };
};

const classifyError = (status: number, body: string, endpoint: string, headers: Headers): never => {
  if (status === 429) {
    const retryAfter = headers.get('Retry-After');
    throw ToolError.rateLimited(`Rate limited: ${endpoint}`, retryAfter ? parseRetryAfterMs(retryAfter) : undefined);
  }
  if (status === 401 || status === 403) throw ToolError.auth(`Auth error (${status}): ${body}`);
  if (status === 404) throw ToolError.notFound(`Not found: ${endpoint}`);
  if (status === 422) throw ToolError.validation(`Validation error: ${body}`);
  throw ToolError.internal(`API error (${status}): ${endpoint} — ${body}`);
};

/**
 * Call a LinkedIn Voyager REST API endpoint.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const headers = getHeaders();

  let url = `${VOYAGER_BASE}${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) if (v !== undefined) params.append(k, String(v));
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw ToolError.timeout(`Timed out: ${endpoint}`);
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).substring(0, 512);
    classifyError(response.status, body, endpoint, response.headers);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};

/**
 * Encode a LinkedIn URN for use in GraphQL variable strings.
 * LinkedIn requires full URI encoding of URN values within variable parentheses,
 * including parentheses themselves which encodeURIComponent does not encode.
 */
export const encodeUrn = (urn: string): string => encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');

interface MeResponse {
  miniProfile?: { dashEntityUrn?: string };
}

/**
 * Fetch the current user's profile URN from the /me endpoint.
 * Used by messaging tools that need the mailboxUrn or hostUrn.
 */
export const getMyProfileUrn = async (): Promise<string> => {
  const me = await api<MeResponse>('/me');
  const profileUrn = me.miniProfile?.dashEntityUrn;
  if (!profileUrn) throw ToolError.auth('Could not determine current user profile URN.');
  return profileUrn;
};

/**
 * Call the LinkedIn Messaging GraphQL API.
 * Uses a separate endpoint and accept header from the main Voyager API.
 *
 * queryId hashes are persisted query hashes that change with LinkedIn deployments.
 * When a hash expires, the server returns status 500 with body {"status":500}.
 */
export const messagingGraphql = async <T>(queryId: string, variables: string): Promise<T> => {
  const csrf = getCsrfToken();
  if (!csrf) throw ToolError.auth('Not authenticated — please log in to LinkedIn.');

  const headers: Record<string, string> = {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    accept: 'application/graphql',
  };

  const url = `${MESSAGING_GRAPHQL_BASE}?queryId=${queryId}&variables=${variables}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`Timed out: messaging graphql ${queryId}`);
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 500 && body.includes('"status":500')) {
      throw ToolError.internal(
        'Persisted query hash expired — LinkedIn may have deployed a new client version. Try reloading the LinkedIn tab.',
      );
    }
    classifyError(response.status, body, `messaging:${queryId}`, response.headers);
  }

  return (await response.json()) as T;
};

/**
 * Post a messaging action (send message, mark read, etc.) via the messaging REST API.
 */
export const messagingAction = async <T>(endpoint: string, body: Record<string, unknown>): Promise<T> => {
  const csrf = getCsrfToken();
  if (!csrf) throw ToolError.auth('Not authenticated — please log in to LinkedIn.');

  const headers: Record<string, string> = {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    'Content-Type': 'application/json',
  };

  const url = `${VOYAGER_BASE}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw ToolError.timeout(`Timed out: ${endpoint}`);
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const text = (await response.text().catch(() => '')).substring(0, 512);
    classifyError(response.status, text, endpoint, response.headers);
  }

  if (response.status === 204) return {} as T;
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
};
