/**
 * Snowflake Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies and tokens.
 *
 * Snowflake's internal API uses two transport functions:
 * - nufetch(endpoint, requestContext, providedOptions, versionPrefix) — JSON API
 * - nufetchForm(endpoint, requestContext, providedOptions, versionPrefix) — form-encoded API
 *
 * The entity listing API (worksheets, dashboards) uses nufetchForm with form-encoded
 * body containing {options: JSON.stringify(filterOptions), location: entityType}.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api           — Raw Snowflake API (GET/POST/PUT/DELETE)
 * - listEntities  — List worksheets/dashboards via entity API (form-encoded)
 * - fetchChunk    — Fetch a single query result chunk by queryId and chunkIndex
 * - healthCheck   — Verify user is authenticated
 * - diagnose      — Inspect window.numeracy internals for debugging
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// Window type extension for Snowflake's internal app state
// ---------------------------------------------------------------------------

interface NufetchRequestContext {
  appServerUrl: string;
  decodedUserKey: string;
  isSecondaryUser: boolean;
  role: string;
  userKey: string;
}

declare global {
  interface Window {
    numeracy?: {
      pageState?: {
        user?: { email?: string; id?: string };
        csrfToken?: string;
        userToken?: string;
      };
      stores?: {
        organization?: {
          activeOrg?: { id: string; shortName: string };
        };
        [key: string]: unknown;
      };
      api?: {
        backendHttp?: {
          getRequestContext: () => NufetchRequestContext;
          net?: {
            nufetch: (...args: unknown[]) => Promise<unknown>;
          };
        };
      };
      nufetch?: (...args: unknown[]) => Promise<unknown>;
      nufetchForm?: (...args: unknown[]) => Promise<unknown>;
    };
  }
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

const getNufetch = () => {
  const fn = window.numeracy?.nufetch ?? window.numeracy?.api?.backendHttp?.net?.nufetch;
  if (typeof fn !== 'function') throw new Error('Snowflake nufetch transport not available');
  return fn;
};

const getRequestContext = () => {
  const fn = window.numeracy?.api?.backendHttp?.getRequestContext;
  if (typeof fn !== 'function') throw new Error('Snowflake request context not available');
  return fn();
};

const getOrgId = (): string => {
  const orgId = window.numeracy?.stores?.organization?.activeOrg?.id;
  if (!orgId) throw new Error('Snowflake organization ID not available');
  return orgId;
};

/**
 * Wrap nufetch errors into standard Error instances.
 * nufetch throws custom objects with {statusCode, logDetailMessage, externalErrorCause}.
 */
const wrapNufetchError = (err: unknown): Error => {
  if (err instanceof Error && err.message) return err;
  const obj = err as Record<string, unknown>;
  const status = obj?.statusCode ?? obj?.status ?? 'unknown';
  const msg =
    (typeof obj?.message === 'string' && obj.message) ||
    (typeof obj?.code === 'string' && obj.code) ||
    (typeof obj?.logDetailMessage === 'string' && obj.logDetailMessage) ||
    JSON.stringify(obj);
  return new Error(`Snowflake API ${status}: ${msg}`);
};

// ---------------------------------------------------------------------------
// API transport — JSON-encoded requests via nufetch
// ---------------------------------------------------------------------------

/**
 * Fetch raw chunk text from the Snowflake chunk endpoint.
 * The endpoint returns bare comma-separated JSON row arrays without outer brackets.
 */
const fetchChunkText = async (queryId: string, chunkIndex: number): Promise<string> => {
  const requestContext = getRequestContext();
  const baseUrl = requestContext.appServerUrl;

  const response = await fetch(`${baseUrl}/v1/queries/${queryId}/chunks/${chunkIndex}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-snowflake-context': requestContext.decodedUserKey,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Chunk fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

/**
 * Fetch a query result chunk and parse it into row arrays.
 * Used by the single-chunk fetchChunk action (fallback path).
 */
const fetchChunkDirect = async (queryId: string, chunkIndex: number): Promise<unknown[][]> => {
  const text = await fetchChunkText(queryId, chunkIndex);
  if (!text || text.length === 0) return [];
  return JSON.parse(`[${text}]`) as unknown[][];
};

const callApi = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<unknown> => {
  const nufetch = getNufetch();
  const requestContext = getRequestContext();

  let fullEndpoint = endpoint;
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    fullEndpoint += (fullEndpoint.includes('?') ? '&' : '?') + searchParams.toString();
  }

  // Always pass '' as version prefix — include version in the endpoint path.
  // Non-empty prefix causes nufetch to route to a different host with CORS restrictions.
  let providedOptions: RequestInit | undefined;
  if (method !== 'GET') {
    providedOptions = { method };
    if (body !== undefined) {
      providedOptions.body = JSON.stringify(body);
      providedOptions.headers = { 'Content-Type': 'application/json' };
    }
  }

  try {
    return await nufetch(fullEndpoint, requestContext, providedOptions, '');
  } catch (err) {
    throw wrapNufetchError(err);
  }
};

// ---------------------------------------------------------------------------
// Entity listing — worksheets, dashboards, folders
// ---------------------------------------------------------------------------

interface ListEntitiesOptions {
  location?: string; // 'worksheets' | 'dashboards' | ''
  types?: string[]; // ['query', 'folder'] | ['dashboard']
  owner?: boolean | null; // true = mine, false = shared, null = all
  sort?: { col: string; dir: string };
  limit?: number;
  from?: string; // pagination cursor
  parentFolder?: string; // for subfolder listing
}

const listEntities = async (options: ListEntitiesOptions = {}): Promise<unknown> => {
  const orgId = getOrgId();

  const filterOptions: Record<string, unknown> = {
    sort: options.sort ?? { col: 'modified', dir: 'desc' },
    limit: options.limit ?? 50,
    owner: options.owner ?? null,
    types: options.types ?? ['query', 'folder'],
    showNeverViewed: 'if-invited',
    excludeModels: true,
  };
  if (options.from) filterOptions.from = options.from;
  if (options.parentFolder) filterOptions.parentFolder = options.parentFolder;

  // Use the entity store's api.post directly — it handles URL construction,
  // auth headers, and body encoding correctly.
  const stores = window.numeracy?.stores as Record<string, unknown> | undefined;
  const entityStore = stores?.entity as Record<string, unknown> | undefined;
  const entityApi = entityStore?.api as Record<string, unknown> | undefined;

  if (typeof entityApi?.post === 'function') {
    try {
      return await (entityApi.post as (...args: unknown[]) => Promise<unknown>)({
        path: `/organizations/${orgId}/entities/list`,
        data: {
          options: JSON.stringify(filterOptions),
          location: options.location ?? 'worksheets',
        },
      });
    } catch (err) {
      throw wrapNufetchError(err);
    }
  }

  // Fallback: try nufetch with various body formats
  const endpoint = `/organizations/${orgId}/entities/list`;
  const nufetch = getNufetch();
  const requestContext = getRequestContext();

  const formBody = new URLSearchParams({
    options: JSON.stringify(filterOptions),
    location: options.location ?? 'worksheets',
  }).toString();

  try {
    return await nufetch(
      endpoint,
      requestContext,
      {
        method: 'POST',
        body: formBody,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
      '',
    );
  } catch (err) {
    throw wrapNufetchError(err);
  }
};

// ---------------------------------------------------------------------------
// Diagnostics — inspect window.numeracy internals for debugging
// ---------------------------------------------------------------------------

const diagnose = (): Record<string, unknown> => {
  const numeracy = window.numeracy as Record<string, unknown> | undefined;
  if (!numeracy) return { available: false };

  const pageState = numeracy.pageState as Record<string, unknown> | undefined;
  const api = numeracy.api as Record<string, unknown> | undefined;
  const backendHttp = api?.backendHttp as Record<string, unknown> | undefined;
  const nufetchFn = numeracy.nufetch ?? (backendHttp?.net as Record<string, unknown> | undefined)?.nufetch;

  let requestContext: unknown = null;
  if (typeof backendHttp?.getRequestContext === 'function') {
    try {
      requestContext = (backendHttp.getRequestContext as () => unknown)();
    } catch (e) {
      requestContext = { error: String(e) };
    }
  }

  const stores = numeracy.stores as Record<string, unknown> | undefined;
  const org = stores?.organization as Record<string, unknown> | undefined;

  return {
    available: true,
    url: window.location.href,
    hasNufetch: typeof nufetchFn === 'function',
    hasNufetchForm: typeof numeracy.nufetchForm === 'function',
    hasRequestContext: typeof backendHttp?.getRequestContext === 'function',
    requestContext,
    user: pageState?.user ? { email: (pageState.user as Record<string, unknown>).email } : undefined,
    orgId: (org?.activeOrg as Record<string, unknown>)?.id,
    topKeys: Object.keys(numeracy),
  };
};

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const [, action] = method.split('.');

  try {
    switch (action) {
      case 'api': {
        const endpoint = params?.endpoint as string;
        if (!endpoint) return fail(id, INVALID_PARAMS, 'Missing required parameter: endpoint');

        const httpMethod = (params?.method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'GET';
        const queryParams = params?.params as Record<string, unknown> | undefined;
        const body = params?.body;
        const data = await callApi(endpoint, httpMethod, queryParams, body);
        return ok(id, data);
      }

      case 'listEntities': {
        const options = (params ?? {}) as ListEntitiesOptions;
        const data = await listEntities(options);
        return ok(id, data);
      }

      case 'healthCheck': {
        const user = window.numeracy?.pageState?.user;
        return ok(id, { user: !!user, email: user?.email });
      }

      case 'fetchChunk': {
        const queryId = params?.queryId as string;
        const chunkIndex = params?.chunkIndex as number;
        if (!queryId) return fail(id, INVALID_PARAMS, 'Missing required parameter: queryId');
        if (chunkIndex === undefined || chunkIndex === null)
          return fail(id, INVALID_PARAMS, 'Missing required parameter: chunkIndex');

        const chunkData = await fetchChunkDirect(queryId, chunkIndex);
        return ok(id, chunkData);
      }

      case 'diagnose':
        return ok(id, diagnose());

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerAdapter('snowflake', handleRequest);

export {};
