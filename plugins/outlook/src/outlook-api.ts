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

/** The outcome of one cascade attempt: `done` stops and caches the token; otherwise advance. */
type CascadeAttempt<R> = { done: true; value: R } | { done: false };

/**
 * Try `attempt` with each auth candidate for a capability's cache slot: the cached
 * winner first, then every other MSAL candidate, caching whichever token the attempt
 * accepts. `attempt` returns `{ done: true, value }` to stop (caching that token), or
 * `{ done: false }` to advance to the next candidate (as on a 401/403). Throws an auth
 * error when no candidate is accepted. This is the shared spine of every authenticated
 * transport (`api`, `owsRequest`, `attachFileToMessage`) — each differs only in how it
 * maps a response to a done/advance outcome.
 */
const cascadeAuth = async <R>(
  cacheKey: string,
  attempt: (auth: OutlookAuth) => Promise<CascadeAttempt<R>>,
): Promise<R> => {
  const cached = getAuthCache<OutlookAuth>(cacheKey);
  if (cached) {
    const outcome = await attempt(cached);
    // The cached token is already stored — return without re-caching it.
    if (outcome.done) return outcome.value;
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
    const outcome = await attempt(auth);
    if (outcome.done) {
      setAuthCache(cacheKey, auth);
      return outcome.value;
    }
  }

  throw ToolError.auth('Authentication expired — please refresh the Outlook page.');
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
): Promise<T> =>
  cascadeAuth<T>(AUTH_CACHE_KEY[capability], async auth => {
    const r = await sendRequest<T>(auth, endpoint, options);
    return r === null ? { done: false } : { done: true, value: r };
  });

// OWS gateway lives on the OWA page's own origin — a third base distinct from Graph
// and Outlook REST. It serves the client-side compose settings (roaming signatures,
// startup data) that Graph's mailboxSettings does not expose. The adapter runs on
// whichever OWA host matched (outlook.cloud.microsoft, outlook.office.com, or
// outlook.office365.com), so resolve against the current origin to stay same-origin
// rather than hardcoding one host. Read lazily (not at module scope) because the
// plugin module is also loaded in Node at build time, where `window` is undefined.
const owsBaseUrl = (): string => window.location.origin;
const OWS_AUTH_CACHE_KEY = 'outlook-ows';

/** MSAL access-token claims OWS routing headers are derived from. */
interface OwsTokenClaims {
  puid?: string;
  tid?: string;
}

/**
 * Read the `puid`/`tid` claims from an MSAL access token's JWT payload. No signature
 * verification — the token is already trusted (we minted the request with it); we
 * only need its routing hints. Returns an empty object for any malformed token.
 */
const decodeTokenClaims = (jwt: string): OwsTokenClaims => {
  const payload = jwt.split('.')[1];
  if (!payload) return {};
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      puid: typeof parsed.puid === 'string' ? parsed.puid : undefined,
      tid: typeof parsed.tid === 'string' ? parsed.tid : undefined,
    };
  } catch {
    return {};
  }
};

/**
 * Build the header set OWS gateway endpoints expect. The mailbox anchor
 * (`x-anchormailbox` / `x-routingparameter-sessionkey`) is derived from the token's
 * own `puid`/`tid` claims so the gateway routes to the right mailbox's settings.
 */
const buildOwsHeaders = (token: string, extra?: Record<string, string>): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'x-ms-appname': 'owa-reactmail',
    owaappid: '00000002-0000-0ff1-ce00-000000000000',
    'x-outlook-client': 'owa',
    ...extra,
  };
  const { puid, tid } = decodeTokenClaims(token);
  if (puid) {
    const anchor = tid ? `PUID:${puid}@${tid}` : `PUID:${puid}`;
    headers['x-anchormailbox'] = anchor;
    headers['x-routingparameter-sessionkey'] = anchor;
  }
  return headers;
};

/**
 * Encode an OWS query string with `encodeURIComponent` per value, yielding `%20` for
 * spaces (in signature display names) and `%2C` for commas (the `settingname` list
 * delimiter) — both of which the OWS gateway accepts. `URLSearchParams` is avoided
 * because it encodes spaces as `+`, which OWS does not decode back to a space.
 */
const encodeOwsQuery = (query: Record<string, string | number | boolean | undefined>): string => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
};

interface OwsRequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

type OwsOutcome<T> = { kind: 'ok'; data: T } | { kind: 'notFound' } | { kind: 'authFail' };

/**
 * Send one OWS request with a specific token. OWS is same-origin, so cookies ride
 * along with the Bearer token. A 404 means the token authenticated but the settings
 * collection holds no such item (e.g. a signature with no body) — distinct from
 * 401/403, which signals "try the next candidate token".
 */
const sendOwsRequest = async <T>(
  token: string,
  endpoint: string,
  options: OwsRequestOptions,
): Promise<OwsOutcome<T>> => {
  const qs = options.query ? encodeOwsQuery(options.query) : '';
  const base = owsBaseUrl();
  const url = qs ? `${base}${endpoint}?${qs}` : `${base}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: buildOwsHeaders(token, options.headers),
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout('Microsoft settings request timed out.');
    }
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (response.status === 401 || response.status === 403) return { kind: 'authFail' };
  if (response.status === 404) return { kind: 'notFound' };
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
    throw ToolError.rateLimited('Microsoft API rate limit exceeded.', retryMs);
  }
  if (!response.ok) {
    throw ToolError.internal(`Microsoft settings request failed (${response.status}).`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? ((await response.json()) as T) : ({} as T);
  return { kind: 'ok', data };
};

/**
 * Request an OWS gateway endpoint on the OWA origin (roaming signature settings,
 * startup data), cascading through every MSAL candidate on 401/403 exactly like
 * `api()` and caching the winner in its own slot. Returns `undefined` when a token
 * authenticated but the endpoint returned 404 (no such setting), so callers can
 * treat a missing signature as "none configured" rather than an error. Throws only
 * when no candidate authenticates at all.
 */
export const owsRequest = async <T>(endpoint: string, options: OwsRequestOptions = {}): Promise<T | undefined> =>
  cascadeAuth<T | undefined>(OWS_AUTH_CACHE_KEY, async auth => {
    const outcome = await sendOwsRequest<T>(auth.token, endpoint, options);
    if (outcome.kind === 'ok') return { done: true, value: outcome.data };
    // A 404 means this token authenticated (the gateway resolved its mailbox) and the
    // setting is simply absent — a valid winner to cache, so a genuinely-missing
    // signature does not re-cascade through every token on each subsequent call.
    if (outcome.kind === 'notFound') return { done: true, value: undefined };
    return { done: false };
  });

/** Graph vs Outlook REST namespaces for the fileAttachment OData type. */
const FILE_ATTACHMENT_ODATA_TYPE: Record<'graph' | 'outlook', string> = {
  graph: '#microsoft.graph.fileAttachment',
  outlook: '#Microsoft.OutlookServices.FileAttachment',
};

/** A file to embed in a message as a copy of its bytes. */
export interface FileAttachmentInput {
  /** File name including extension, e.g. "report.pdf". */
  name: string;
  /** MIME type; defaults to application/octet-stream. */
  contentType?: string;
  /** Base64-encoded file content, with no data: URI prefix. */
  contentBase64: string;
}

/**
 * Embed a file in an existing draft as a `fileAttachment`. Reuses the `mail` cache
 * slot so the attach lands on the same token — and therefore the same API base and
 * message-id namespace — that created the draft (a draft id minted on Graph is not
 * valid on Outlook REST, and vice versa). The attachment body is built per base: the
 * two APIs disagree on the OData type namespace, and `sendRequest` PascalCases the
 * property keys for the Outlook REST base while leaving Graph's camelCase untouched.
 */
export const attachFileToMessage = async (messageId: string, attachment: FileAttachmentInput): Promise<void> =>
  cascadeAuth<void>(AUTH_CACHE_KEY.mail, async auth => {
    const namespace = auth.apiBase === GRAPH_API_BASE ? 'graph' : 'outlook';
    const body = {
      '@odata.type': FILE_ATTACHMENT_ODATA_TYPE[namespace],
      name: attachment.name,
      contentType: attachment.contentType ?? 'application/octet-stream',
      contentBytes: attachment.contentBase64,
    };
    const r = await sendRequest<unknown>(auth, `/me/messages/${messageId}/attachments`, { method: 'POST', body });
    return r === null ? { done: false } : { done: true, value: undefined };
  });

/**
 * Graph vs Outlook REST namespaces and enum casing for the referenceAttachment OData
 * type. Graph spells the enums camelCase; Outlook REST spells them PascalCase. Only
 * the property keys are transformed by `sendRequest` — the string enum *values* are
 * set here per base.
 */
const REFERENCE_ATTACHMENT: Record<'graph' | 'outlook', { type: string; providerType: string; permission: string }> = {
  graph: { type: '#microsoft.graph.referenceAttachment', providerType: 'oneDriveBusiness', permission: 'view' },
  outlook: {
    type: '#Microsoft.OutlookServices.ReferenceAttachment',
    providerType: 'OneDriveBusiness',
    permission: 'View',
  },
};

/** A file already in OneDrive, attached to a message as a sharing link. */
export interface ReferenceAttachmentInput {
  /** File name including extension, e.g. "report.pdf". */
  name: string;
  /** The OneDrive sharing-link URL recipients open the file from. */
  sourceUrl: string;
}

/**
 * Attach a OneDrive file to a draft as a `referenceAttachment` (a sharing link rather
 * than an embedded copy). Reuses the `mail` cache slot for the same base/message-id
 * reasons as {@link attachFileToMessage}, and builds the body per base.
 */
export const attachReferenceToMessage = async (
  messageId: string,
  attachment: ReferenceAttachmentInput,
): Promise<void> =>
  cascadeAuth<void>(AUTH_CACHE_KEY.mail, async auth => {
    const meta = REFERENCE_ATTACHMENT[auth.apiBase === GRAPH_API_BASE ? 'graph' : 'outlook'];
    const body = {
      '@odata.type': meta.type,
      name: attachment.name,
      sourceUrl: attachment.sourceUrl,
      providerType: meta.providerType,
      permission: meta.permission,
      isFolder: false,
    };
    const r = await sendRequest<unknown>(auth, `/me/messages/${messageId}/attachments`, { method: 'POST', body });
    return r === null ? { done: false } : { done: true, value: undefined };
  });

/** Wrap a fetch rejection as a structured, retryable network error. */
const toNetworkError = (err: unknown): ToolError => {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return ToolError.timeout('Microsoft API request timed out.');
  }
  return new ToolError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`, 'network_error', {
    category: 'internal',
    retryable: true,
  });
};

/**
 * Cloud attachments need Drive write scope, which mail tokens do not carry, so they
 * cascade in their own cache slot restricted to Graph tokens — the only base that can
 * reach `/me/drive`. A mail-scoped Graph token 401/403s and the cascade advances; if
 * no candidate carries Files scope, the caller sees a clean auth error.
 */
const FILES_AUTH_CACHE_KEY = 'outlook-files';

/** The OneDrive folder cloud attachments are uploaded to, mirroring OWA's compose. */
const ONEDRIVE_ATTACHMENTS_FOLDER = 'Attachments';

/**
 * Upload a file to the user's OneDrive and return an organization-scoped view link for
 * it — the source URL a `referenceAttachment` points at. Uploading and link creation
 * share one Graph Files-scoped token, discovered by cascading only through Graph
 * candidates (a Drive call is meaningless against the Outlook REST base). A single PUT
 * to `/content` handles files up to Graph's simple-upload ceiling (250 MB), so cloud
 * attachments carry the large files embedding cannot.
 */
export const uploadAttachmentToOneDrive = async (
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<string> =>
  cascadeAuth<string>(FILES_AUTH_CACHE_KEY, async auth => {
    if (auth.apiBase !== GRAPH_API_BASE) return { done: false };
    const authHeader = { Authorization: `Bearer ${auth.token}` };
    const encodedPath = `${encodeURIComponent(ONEDRIVE_ATTACHMENTS_FOLDER)}/${encodeURIComponent(name)}`;

    let uploadRes: Response;
    try {
      uploadRes = await fetch(`${GRAPH_API_BASE}/me/drive/root:/${encodedPath}:/content`, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': contentType },
        body: new Blob([bytes]),
        credentials: 'omit',
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw toNetworkError(err);
    }
    if (uploadRes.status === 401 || uploadRes.status === 403) return { done: false };
    if (!uploadRes.ok) throw ToolError.internal(`OneDrive upload failed (${uploadRes.status}).`);
    const item = (await uploadRes.json()) as { id?: string };
    if (!item.id) throw ToolError.internal('OneDrive upload returned no item id.');

    let linkRes: Response;
    try {
      linkRes = await fetch(`${GRAPH_API_BASE}/me/drive/items/${item.id}/createLink`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'organization' }),
        credentials: 'omit',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw toNetworkError(err);
    }
    if (linkRes.status === 401 || linkRes.status === 403) return { done: false };
    if (!linkRes.ok) throw ToolError.internal(`OneDrive share-link creation failed (${linkRes.status}).`);
    const link = (await linkRes.json()) as { link?: { webUrl?: string } };
    const webUrl = link.link?.webUrl;
    if (!webUrl) throw ToolError.internal('OneDrive share-link response contained no URL.');
    return { done: true, value: webUrl };
  });

/**
 * Upload-session chunk size. Microsoft requires every chunk but the last to be a
 * multiple of 320 KiB; this is 10 × 320 KiB (3.125 MiB), comfortably under the 4 MiB
 * per-request ceiling.
 */
const UPLOAD_SESSION_CHUNK_BYTES = 320 * 1024 * 10;

/** A file whose bytes are streamed to a draft, for embeds too large to inline. */
export interface LargeFileAttachmentInput {
  /** File name including extension, e.g. "report.pdf". */
  name: string;
  /** MIME type; defaults to application/octet-stream. */
  contentType?: string;
  /** Raw file bytes. */
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Embed a file too large for a single inline request (over ~3 MB) by opening a Graph
 * attachment upload session and streaming the bytes to it in sequential chunks. The
 * session is opened on the draft's mail token/base — the same base/message-id
 * reasoning as {@link attachFileToMessage} — while the returned `uploadUrl` is
 * pre-authorized, so the chunk PUTs carry no bearer token. The final chunk's response
 * commits the attachment.
 */
export const attachLargeFileToMessage = async (messageId: string, file: LargeFileAttachmentInput): Promise<void> => {
  const contentType = file.contentType ?? 'application/octet-stream';
  const total = file.bytes.byteLength;

  const session = await cascadeAuth<{ uploadUrl?: string }>(AUTH_CACHE_KEY.mail, async auth => {
    // createUploadSession exists only on Graph (Outlook REST v2.0 is decommissioned),
    // so skip any Outlook REST candidate rather than let it throw and abort the cascade.
    if (auth.apiBase !== GRAPH_API_BASE) return { done: false };
    const body = { AttachmentItem: { attachmentType: 'file', name: file.name, size: total, contentType } };
    const r = await sendRequest<{ uploadUrl?: string }>(
      auth,
      `/me/messages/${messageId}/attachments/createUploadSession`,
      { method: 'POST', body },
    );
    return r === null ? { done: false } : { done: true, value: r };
  });

  const uploadUrl = session.uploadUrl;
  if (!uploadUrl) throw ToolError.internal('Attachment upload session returned no upload URL.');

  // The uploadUrl is pre-authorized; chunks must be sent in order. Content-Length is a
  // forbidden header the browser sets itself, so only Content-Range is set here.
  for (let start = 0; start < total; start += UPLOAD_SESSION_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_SESSION_CHUNK_BYTES, total);
    const chunk = file.bytes.subarray(start, end);

    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
        body: new Blob([chunk]),
        credentials: 'omit',
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw toNetworkError(err);
    }
    // 200 accepts an intermediate chunk; 201 commits the attachment on the final chunk.
    if (res.status !== 200 && res.status !== 201) {
      throw ToolError.internal(`Attachment chunk upload failed (${res.status}).`);
    }
  }
};
