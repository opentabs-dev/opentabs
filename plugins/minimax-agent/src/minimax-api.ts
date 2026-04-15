import {
  ToolError,
  getLocalStorage,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

/**
 * MiniMax Agent API wrapper.
 *
 * The MiniMax Agent web app uses an Axios instance with custom request-signing
 * interceptors (timestamp, HMAC signature, yy hash). Rather than reimplementing
 * the signing logic, we access the app's own Axios instance through its webpack
 * module system. This ensures all requests are signed identically to the web app.
 */

// biome-ignore lint/suspicious/noExplicitAny: Axios instance from webpack internals
type AxiosInstance = any;

const CACHE_NS = 'minimax-agent';

interface MinimaxAuth {
  token: string;
}

/** Cached webpack require function — set once on first successful probe. */
let cachedRequire: ((id: string | number) => unknown) | null = null;

/** Probe the webpack chunk to get the app's Axios require function. */
const getWebpackRequire = (): ((id: string | number) => unknown) | null => {
  if (cachedRequire) return cachedRequire;

  const cached = getAuthCache<{ hasAxios: true }>(CACHE_NS);
  const chunk =
    // biome-ignore lint/suspicious/noExplicitAny: webpack runtime global
    (globalThis as any).webpackChunk_N_E as
      | Array<[string[], Record<string, unknown>, (req: unknown) => void]>
      | undefined;
  if (!chunk) return null;

  // Use a unique probe ID to avoid webpack caching collisions (gotcha #30)
  const probeId = `__ot_mx_${Date.now()}`;
  let req: ((id: string | number) => unknown) | null = null;
  chunk.push([
    [probeId],
    {},
    r => {
      req = r as (id: string | number) => unknown;
    },
  ]);
  if (!req && cached) clearAuthCache(CACHE_NS);
  if (req) cachedRequire = req;
  return req;
};

/** Reset the cached webpack require function (called on adapter teardown). */
export const resetWebpackCache = (): void => {
  cachedRequire = null;
};

/** Get the app's pre-configured Axios instance (module 33993, export ZP). */
const getAxios = (): AxiosInstance | null => {
  const req = getWebpackRequire();
  if (!req) return null;
  try {
    const mod = req(33993) as { ZP?: AxiosInstance } | undefined;
    return mod?.ZP ?? null;
  } catch {
    return null;
  }
};

/** Check if the user is authenticated (JWT token present in localStorage). */
export const isAuthenticated = (): boolean => {
  const token = getLocalStorage('_token');
  return !!token && token.length > 10;
};

/** Wait for auth to become available (SPA hydration). */
export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated() && getAxios() !== null, {
      interval: 500,
      timeout: 8000,
    });
    setAuthCache(CACHE_NS, { hasAxios: true });
    return true;
  } catch {
    return false;
  }
};

/** Get the auth token from localStorage. */
const getAuth = (): MinimaxAuth | null => {
  const token = getLocalStorage('_token');
  if (!token) return null;
  return { token };
};

/** Base response envelope used by all /matrix/api/v1/ endpoints. */
interface BaseResp {
  status_code?: number;
  status_msg?: string;
}

/** Classify API error responses into ToolError categories. */
const classifyError = (
  statusCode: number | undefined,
  statusMsg: string | undefined,
  httpStatus?: number,
): ToolError => {
  if (httpStatus === 401 || statusCode === 2) {
    clearAuthCache(CACHE_NS);
    return ToolError.auth(statusMsg ?? 'Not authenticated — please log in.');
  }
  if (httpStatus === 403) return ToolError.auth(statusMsg ?? 'Forbidden');
  if (httpStatus === 404) return ToolError.notFound(statusMsg ?? 'Not found');
  if (httpStatus === 429) return ToolError.rateLimited(statusMsg ?? 'Rate limited');
  if (statusCode === -1) return ToolError.internal(statusMsg ?? 'Server is busy');
  return ToolError.internal(statusMsg ?? 'Unknown error');
};

/**
 * Make a GET request through the app's Axios instance.
 * The interceptors handle auth token injection and request signing automatically.
 */
export const apiGet = async <T>(endpoint: string): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in.');

  const ax = getAxios();
  if (!ax) throw ToolError.internal('MiniMax Agent app not ready — please reload the page.');

  try {
    const resp = await ax.get(endpoint);
    const data = resp.data;

    // Check for statusInfo error envelope (/v1/api/ endpoints)
    if (data?.statusInfo?.code && data.statusInfo.code !== 0) {
      throw classifyError(data.statusInfo.code, data.statusInfo.message);
    }
    // Check for base_resp error envelope (/matrix/api/ endpoints)
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw classifyError(data.base_resp.status_code, data.base_resp.status_msg);
    }

    return data as T;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    // Axios error with response
    const axErr = e as {
      response?: { status?: number; data?: { base_resp?: BaseResp; statusInfo?: { code?: number; message?: string } } };
      message?: string;
    };
    if (axErr.response) {
      const br = axErr.response.data?.base_resp;
      const si = axErr.response.data?.statusInfo;
      throw classifyError(br?.status_code ?? si?.code, br?.status_msg ?? si?.message, axErr.response.status);
    }
    throw ToolError.internal(axErr.message ?? 'Request failed');
  }
};

/**
 * Make a POST request through the app's Axios instance.
 * The interceptors handle auth token injection and request signing automatically.
 */
export const apiPost = async <T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> => {
  if (!getAuth()) throw ToolError.auth('Not authenticated — please log in.');

  const ax = getAxios();
  if (!ax) throw ToolError.internal('MiniMax Agent app not ready — please reload the page.');

  try {
    const resp = await ax.post(endpoint, body);
    const data = resp.data;

    if (data?.statusInfo?.code && data.statusInfo.code !== 0) {
      throw classifyError(data.statusInfo.code, data.statusInfo.message);
    }
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw classifyError(data.base_resp.status_code, data.base_resp.status_msg);
    }

    return data as T;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    const axErr = e as {
      response?: { status?: number; data?: { base_resp?: BaseResp; statusInfo?: { code?: number; message?: string } } };
      message?: string;
    };
    if (axErr.response) {
      const br = axErr.response.data?.base_resp;
      const si = axErr.response.data?.statusInfo;
      throw classifyError(br?.status_code ?? si?.code, br?.status_msg ?? si?.message, axErr.response.status);
    }
    // Axios interceptor throws statusInfo objects directly on business errors
    const errObj = e as { code?: number; message?: string };
    if (typeof errObj.code === 'number') {
      throw classifyError(errObj.code, errObj.message);
    }
    throw ToolError.internal(axErr.message ?? 'Request failed');
  }
};
