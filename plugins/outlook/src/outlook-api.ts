import {
  ToolError,
  buildQueryString,
  clearAuthCache,
  getAuthCache,
  getLocalStorage,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_API_BASE = 'https://outlook.office.com/api/v2.0';

// Outlook enterprise MSAL client ID
const MSAL_CLIENT_ID = '9199bf20-a13f-4107-85dc-02114787ef48';
// Consumer fallback
const MSAL_CLIENT_ID_CONSUMER = '2821b473-fe24-4c86-ba16-62834d6e80c3';

interface OutlookAuth {
  token: string;
  apiBase: string; // which API base URL this token works with
}

/**
 * A request capability. Mail and calendar can require different Graph scopes, and
 * a single token is not guaranteed to carry both — enterprise tenants commonly
 * issue a narrowly-scoped Graph token alongside a broad Outlook REST token. The
 * `api()` cascade discovers the working token empirically (trying every candidate
 * on 401/403), so capability does not pre-filter candidates; it only selects an
 * independent cache slot. Separate slots stop a mail call and a calendar call from
 * evicting each other's winning token under one shared cache — which would make the
 * two endpoints repeatedly re-cascade against each other. Calendar read and write
 * are split so a mutating call never pins to a read-only token cached by a read.
 */
type Capability = 'mail' | 'calendar' | 'calendar-write';

/** Per-capability auth cache key, keeping each token bucket separate. */
const AUTH_CACHE_KEY: Record<Capability, string> = {
  mail: 'outlook',
  calendar: 'outlook-calendar',
  'calendar-write': 'outlook-calendar-write',
};

/**
 * Enumerate every MSAL client id whose token-index key starts with `prefix`.
 * The SDK's `findLocalStorageEntry` returns only the first match, which silently
 * drops every additional client id present when a user has multiple Microsoft
 * apps signed in.
 */
const findAllMsalClientIds = (prefix: string): string[] => {
  const ids: string[] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) {
        ids.push(key.slice(prefix.length));
      }
    }
  } catch {
    // SecurityError or missing localStorage — nothing we can do
  }
  return ids;
};

/**
 * True when the AAD scope claim (space-separated) contains at least one scope
 * whose URL hostname equals `host`. Each scope is parsed as a URL and compared
 * by `hostname` rather than substring-matched so a malicious value like
 * `https://attacker.com/graph.microsoft.com/foo` cannot satisfy the check.
 */
const scopeClaimHasHost = (target: string, host: string): boolean => {
  for (const scope of target.split(/\s+/)) {
    if (scope.length === 0) continue;
    try {
      if (new URL(scope).hostname.toLowerCase() === host) return true;
    } catch {
      // non-URL scopes (openid, profile, email, ...) — skip
    }
  }
  return false;
};

/**
 * Return unexpired access tokens whose target scope claim grants the given host
 * from the MSAL v2 or v3 cache. Both versions share the same entry shape
 * (`secret`, `target`, `expiresOn`); only the index-key prefix differs.
 */
const findMsalModernTokens = (version: '2' | '3', clientId: string, host: string): OutlookAuth[] => {
  const tokenKeysRaw = getLocalStorage(`msal.${version}.token.keys.${clientId}`);
  if (!tokenKeysRaw) return [];

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(tokenKeysRaw);
  } catch {
    return [];
  }
  if (!tokenKeys.accessToken) return [];

  const apiBase = host === 'graph.microsoft.com' ? GRAPH_API_BASE : OUTLOOK_API_BASE;
  const matches: OutlookAuth[] = [];
  for (const key of tokenKeys.accessToken) {
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) continue;

      const target: string = parsed.target ?? '';
      if (!scopeClaimHasHost(target, host)) continue;

      // Strict numeric coercion — Number.parseInt would accept '9999999999junk'
      // as a giant future expiry; Number(...) returns NaN for trailing garbage.
      const expiresOn = Number(parsed.expiresOn);
      if (!Number.isInteger(expiresOn) || expiresOn <= 0 || expiresOn * 1000 < Date.now()) continue;

      matches.push({ token: parsed.secret, apiBase });
    } catch {
      // skip invalid entries
    }
  }
  return matches;
};

/** Search MSAL v1 token cache for valid Graph API access tokens. */
const findMsalV1Tokens = (clientId: string): OutlookAuth[] => {
  const tokenKeysRaw = getLocalStorage(`msal.token.keys.${clientId}`);
  if (!tokenKeysRaw) return [];

  let tokenKeys: { accessToken?: string[] };
  try {
    tokenKeys = JSON.parse(tokenKeysRaw);
  } catch {
    return [];
  }
  if (!tokenKeys.accessToken) return [];

  const matches: OutlookAuth[] = [];
  for (const key of tokenKeys.accessToken) {
    if (!/(?:^|[\s/])graph\.microsoft\.com(?:[/\s]|$)/.test(key)) continue;
    const raw = getLocalStorage(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) continue;
      const expiresOn = Number(parsed.expiresOn);
      if (!Number.isInteger(expiresOn) || expiresOn <= 0 || expiresOn * 1000 < Date.now()) continue;
      matches.push({ token: parsed.secret, apiBase: GRAPH_API_BASE });
    } catch {
      // skip invalid entries
    }
  }
  return matches;
};

/**
 * Return every MSAL-cached token plausibly usable against Graph or Outlook REST,
 * deduplicated and ordered by preference (v3 enterprise → v2 enterprise → v1
 * consumer → other client ids). `api()` cascades through the list on 401/403;
 * the first token the API accepts is cached for subsequent calls.
 */
const collectAuthCandidates = (): OutlookAuth[] => {
  const all: OutlookAuth[] = [];

  // Enterprise, known client id — v3 then v2, Graph then Outlook REST per version
  for (const version of ['3', '2'] as const) {
    all.push(...findMsalModernTokens(version, MSAL_CLIENT_ID, 'graph.microsoft.com'));
    all.push(...findMsalModernTokens(version, MSAL_CLIENT_ID, 'outlook.office.com'));
  }

  // Consumer v1
  all.push(...findMsalV1Tokens(MSAL_CLIENT_ID_CONSUMER));

  // Fallback: every other client id present in localStorage, modern then v1.
  // Enumerate (not first-match) so users with multiple Microsoft apps signed in
  // surface every token, not just the first index key the iterator hits.
  for (const version of ['3', '2'] as const) {
    for (const cid of findAllMsalClientIds(`msal.${version}.token.keys.`)) {
      if (cid === MSAL_CLIENT_ID) continue;
      all.push(...findMsalModernTokens(version, cid, 'graph.microsoft.com'));
      all.push(...findMsalModernTokens(version, cid, 'outlook.office.com'));
    }
  }
  for (const cid of findAllMsalClientIds('msal.token.keys.')) {
    if (cid === MSAL_CLIENT_ID_CONSUMER) continue;
    all.push(...findMsalV1Tokens(cid));
  }

  // Deduplicate by token — multiple lookups can surface the same secret
  const seen = new Set<string>();
  return all.filter(c => {
    if (seen.has(c.token)) return false;
    seen.add(c.token);
    return true;
  });
};

export const isAuthenticated = (): boolean => {
  if (getAuthCache<OutlookAuth>(AUTH_CACHE_KEY.mail)) return true;
  return collectAuthCandidates().length > 0;
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

/**
 * Recursively convert PascalCase keys to camelCase.
 * Outlook REST API returns PascalCase; Graph returns camelCase.
 * Normalizing to camelCase lets all mappers work with both APIs.
 */
const toCamelCase = (str: string): string => str.charAt(0).toLowerCase() + str.slice(1);

const normalizeKeys = (obj: unknown): unknown => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip OData metadata keys like @odata.context
    const newKey = key.startsWith('@') ? key : toCamelCase(key);
    result[newKey] = normalizeKeys(value);
  }
  return result;
};

const toPascalCase = (str: string): string => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Recursively convert object keys to PascalCase.
 * The Outlook REST API deserializes request bodies case-sensitively and requires
 * PascalCase property names for both entities (Subject, Start/DateTime) and OData
 * action parameters (Schedules, Comment). Graph uses camelCase. Request bodies are
 * authored in camelCase and transformed here when the request targets the REST base;
 * GET query options ($filter, $orderby) are case-insensitive on REST and unaffected.
 */
const pascalCaseKeys = (obj: unknown): unknown => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(pascalCaseKeys);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[toPascalCase(key)] = pascalCaseKeys(value);
  }
  return result;
};

/**
 * Send an authenticated request and handle the response.
 * Returns the parsed response or throws on error.
 * On 401/403, returns `null` to signal the caller to retry with a fresh token.
 */
const sendRequest = async <T>(
  auth: OutlookAuth,
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  },
): Promise<T | null> => {
  const isOutlookApi = auth.apiBase === OUTLOOK_API_BASE;

  // Outlook REST API uses different $select field names, so drop $select
  // and let it return all fields. The normalizeKeys step handles casing.
  const query = options.query ? { ...options.query } : undefined;
  if (isOutlookApi && query) {
    delete (query as Record<string, unknown>).$select;
  }

  const qs = query ? buildQueryString(query) : '';
  const url = qs ? `${auth.apiBase}${endpoint}?${qs}` : `${auth.apiBase}${endpoint}`;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    ...options.headers,
  };

  const init: FetchFromPageOptions = { method, headers };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    const body = isOutlookApi ? pascalCaseKeys(options.body) : options.body;
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Microsoft API request timed out.');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ToolError('Request aborted', 'aborted');
    }
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (response.status === 204) return {} as T;

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Microsoft API rate limit exceeded.', retryMs);
  }

  // Signal caller to retry with a fresh token
  if (response.status === 401 || response.status === 403) return null;

  if (response.status === 404) {
    throw ToolError.notFound('The requested resource was not found.');
  }

  if (!response.ok) {
    let errorMsg = `Microsoft API error (${response.status})`;
    try {
      const errBody = (await response.json()) as {
        error?: { message?: string; code?: string };
      };
      if (errBody.error?.message) {
        errorMsg = errBody.error.message;
      }
    } catch {
      // ignore parse errors
    }
    if (response.status === 400 || response.status === 422) {
      throw ToolError.validation(errorMsg);
    }
    throw ToolError.internal(errorMsg);
  }

  // Successful actions (cancel, RSVP, sendMail) often return 202/205 or a 200 with
  // an empty body and no JSON. Only parse when the response actually carries JSON.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return {} as T;

  const json = await response.json();
  return (isOutlookApi ? normalizeKeys(json) : json) as T;
};

/**
 * Make an authenticated request to a Microsoft 365 API for the given capability,
 * cascading through every MSAL-cached candidate on 401/403 (the capability's cached
 * winner first) and caching the first that succeeds under that capability's slot.
 * Mail requests default to the `mail` capability; calendar tools pass `calendar` or
 * `calendar-write` so their winning token is cached separately and never thrashes a
 * mail-only token. Automatically uses whichever API the resolved token supports
 * (Graph or Outlook REST). Throws an auth error only after every candidate fails.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  } = {},
  capability: Capability = 'mail',
): Promise<T> => {
  const cacheKey = AUTH_CACHE_KEY[capability];

  const cached = getAuthCache<OutlookAuth>(cacheKey);
  if (cached) {
    const r = await sendRequest<T>(cached, endpoint, options);
    if (r !== null) return r;
    clearAuthCache(cacheKey);
  }

  const candidates = collectAuthCandidates();
  // Skip the cached candidate we just tried — it 401'd, no point retrying it.
  const remaining = cached ? candidates.filter(c => c.token !== cached.token) : candidates;
  if (remaining.length === 0) {
    throw ToolError.auth(
      cached
        ? 'Authentication expired — please refresh the Outlook page.'
        : 'Not authenticated — please sign in to Microsoft 365.',
    );
  }

  for (const auth of remaining) {
    const r = await sendRequest<T>(auth, endpoint, options);
    if (r !== null) {
      setAuthCache(cacheKey, auth);
      return r;
    }
  }

  throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
};
