import {
  clearAuthCache,
  getAuthCache,
  getCurrentUrl,
  getMetaContent,
  getPageGlobal,
  parseRetryAfterMs,
  setAuthCache,
  ToolError,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface YnabAuth {
  sessionToken: string;
  deviceId: string;
  userId: string;
  planId: string;
}

interface CatalogResponse<T = Record<string, unknown>> {
  error: { message: string } | null;
  session_token?: string;
  current_server_knowledge?: number;
  changed_entities?: T;
  [key: string]: unknown;
}

// --- Auth extraction ---
// YNAB uses HttpOnly session cookies for primary auth, plus a session token
// embedded in a <meta name="session-token"> tag. The internal API requires
// this token in the X-Session-Token header along with device identification
// headers. The user ID comes from YNAB_CLIENT_CONSTANTS.USER.

const NOT_AUTHENTICATED_MESSAGE = 'Not authenticated — please log in to YNAB.';

const generateDeviceId = (): string => crypto.randomUUID();

const extractPlanId = (): string | null => {
  const url = getCurrentUrl();
  const match = url.match(/app\.ynab\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
  return match?.[1] ?? null;
};

const getAuth = (): YnabAuth | null => {
  const cached = getAuthCache<YnabAuth>('ynab');
  if (cached?.sessionToken && cached.planId) return cached;

  const sessionToken = getMetaContent('session-token');
  if (!sessionToken) return null;

  const user = getPageGlobal('YNAB_CLIENT_CONSTANTS.USER') as { id?: string } | undefined;
  if (!user?.id) return null;

  const planId = extractPlanId();
  if (!planId) return null;

  const deviceId = cached?.deviceId ?? generateDeviceId();

  const auth: YnabAuth = {
    sessionToken,
    deviceId,
    userId: user.id,
    planId,
  };
  setAuthCache('ynab', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getPlanId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth(NOT_AUTHENTICATED_MESSAGE);
  return auth.planId;
};

export const getDeviceId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth(NOT_AUTHENTICATED_MESSAGE);
  return auth.deviceId;
};

export const getUserId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth(NOT_AUTHENTICATED_MESSAGE);
  return auth.userId;
};

export const assertAuthenticated = (): void => {
  if (!getAuth()) throw ToolError.auth(NOT_AUTHENTICATED_MESSAGE);
};

// --- Internal API headers ---

const getHeaders = (): Record<string, string> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth(NOT_AUTHENTICATED_MESSAGE);

  // Read app version fresh on every request — never cache it, since YNAB enforces
  // a minimum version via 426 and will reject stale cached values.
  const appVersion = getPageGlobal('YNAB_CLIENT_CONSTANTS.YNAB_APP_VERSION') as string | undefined;

  const headers: Record<string, string> = {
    'X-Session-Token': auth.sessionToken,
    'X-YNAB-Device-Id': auth.deviceId,
    'X-YNAB-Device-OS': 'web',
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/javascript, */*; q=0.01',
  };
  if (appVersion) headers['X-YNAB-Device-App-Version'] = appVersion;
  return headers;
};

// --- Error handling ---

const handleApiError = async (response: Response, context: string): Promise<never> => {
  const errorBody = (await response.text().catch(() => '')).substring(0, 512);

  if (response.status === 426) {
    clearAuthCache('ynab');
    throw ToolError.auth(
      'YNAB requires an app update (426). The session has been cleared — please reload the YNAB tab and try again.',
    );
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
    throw ToolError.rateLimited(`Rate limited: ${context} — ${errorBody}`, retryMs);
  }
  if (response.status === 401 || response.status === 403) {
    clearAuthCache('ynab');
    throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
  }
  if (response.status === 404) throw ToolError.notFound(`Not found: ${context} — ${errorBody}`);
  if (response.status === 422) throw ToolError.validation(`Validation error: ${context} — ${errorBody}`);
  throw ToolError.internal(`API error (${response.status}): ${context} — ${errorBody}`);
};

const handleNetworkError = (err: unknown, context: string): never => {
  if (err instanceof DOMException && err.name === 'TimeoutError')
    throw ToolError.timeout(`Request timed out: ${context}`);
  if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
  throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
    category: 'internal',
    retryable: true,
  });
};

// --- Catalog API (internal RPC endpoint) ---

export const catalog = async <T = Record<string, unknown>>(
  operationName: string,
  requestData: Record<string, unknown> = {},
): Promise<CatalogResponse<T>> => {
  const headers = getHeaders();
  headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';

  let response: Response;
  try {
    response = await fetch('/api/v1/catalog', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: `operation_name=${encodeURIComponent(operationName)}&request_data=${encodeURIComponent(JSON.stringify(requestData))}`,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    return handleNetworkError(err, operationName);
  }

  if (!response.ok) return handleApiError(response, operationName);

  const data = (await response.json()) as CatalogResponse<T>;
  if (data.error) {
    throw ToolError.internal(`Catalog error (${operationName}): ${data.error.message}`);
  }
  return data;
};

// --- syncBudgetData helper ---
// YNAB requires sync_type, schema_version, and schema_version_of_knowledge on all
// syncBudgetData requests (enforced server-side via 426 if omitted).
//
// We send sync_type: 'delta' with starting_device_knowledge: 0 to receive a full
// snapshot of the budget. Counter-intuitively, sync_type: 'bootstrap' returns
// only the most recent ~1 month of transactions, while delta with zero device
// knowledge returns the full history (verified with the YNAB UI's own captures).
// Verified working as of schema version 41.

const BUDGET_SCHEMA_VERSION = 41;

export const syncBudget = async <T = Record<string, unknown>>(planId: string): Promise<CatalogResponse<T>> =>
  catalog<T>('syncBudgetData', {
    budget_version_id: planId,
    sync_type: 'delta',
    starting_device_knowledge: 0,
    ending_device_knowledge: 0,
    device_knowledge_of_server: 0,
    calculated_entities_included: false,
    schema_version: BUDGET_SCHEMA_VERSION,
    schema_version_of_knowledge: BUDGET_SCHEMA_VERSION,
    changed_entities: {},
  });

// Write operations require the current server_knowledge to succeed.
// Pass serverKnowledge from a prior syncBudget call to avoid a redundant read.

export const syncWrite = async <T = Record<string, unknown>>(
  planId: string,
  changedEntities: Record<string, unknown>,
  serverKnowledge?: number,
): Promise<CatalogResponse<T>> => {
  const knowledge = serverKnowledge ?? (await syncBudget(planId)).current_server_knowledge ?? 0;

  // ending_device_knowledge is the local change counter — YNAB's UI increments
  // it across the session, but since we don't persist any state we send 1 to
  // signal "one new change since 0". The server only enforces monotonic
  // increase relative to its own knowledge, not the client counter, so a
  // constant 1 is what YNAB tolerates from us in practice.
  return catalog<T>('syncBudgetData', {
    budget_version_id: planId,
    sync_type: 'delta',
    starting_device_knowledge: 0,
    ending_device_knowledge: 1,
    device_knowledge_of_server: knowledge,
    calculated_entities_included: false,
    schema_version: BUDGET_SCHEMA_VERSION,
    schema_version_of_knowledge: BUDGET_SCHEMA_VERSION,
    changed_entities: changedEntities,
  });
};

// --- REST API (internal v2 endpoints) ---

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> => {
  const headers = getHeaders();

  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api/v2${endpoint}`, {
      method: options.method ?? 'GET',
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    return handleNetworkError(err, endpoint);
  }

  if (!response.ok) return handleApiError(response, endpoint);

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
