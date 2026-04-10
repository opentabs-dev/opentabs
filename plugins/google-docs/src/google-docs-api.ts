import { getCookie, getCurrentUrl, getPageGlobal, getPageTitle, ToolError, waitUntil } from '@opentabs-dev/plugin-sdk';
import { DOCUMENT_FIELDS, type RawDriveFile } from './tools/schemas.js';

const FALLBACK_GOOGLE_API_KEY = 'AIzaSyD_InbmSFufIEps5UAt2NmB_3LvBH3Sz_8';
const DRIVE_API_BASE = '/drive/v3';

interface GapiResponse<T> {
  status: number;
  result: T;
  body: string;
  headers: Record<string, string>;
}

interface GapiRequestParams {
  path: string;
  method?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: string;
}

interface CurrentDocumentContext {
  documentId: string;
  tabId: string;
  title: string;
  url: string;
}

let apiKeySet = false;

const serializeRequestBody = (body: unknown): string | undefined => {
  if (body === undefined) {
    return undefined;
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
};

const isGapiReady = (): boolean => {
  const requestFn = getPageGlobal('gapi.client.request') as ((args: GapiRequestParams) => unknown) | undefined;
  return typeof requestFn === 'function';
};

const getEmbeddedApiKey = (): string | null => {
  const candidate = getPageGlobal('preload.globals.gmsSuiteApiKey');
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }
  return null;
};

const getApiKey = (): string => getEmbeddedApiKey() ?? FALLBACK_GOOGLE_API_KEY;

const ensureApiKey = (): void => {
  if (apiKeySet) return;

  const setApiKey = getPageGlobal('gapi.client.setApiKey') as ((key: string) => void) | undefined;
  if (!setApiKey) return;

  setApiKey(getApiKey());
  apiKeySet = true;
};

const gapiRequest = <T>(opts: GapiRequestParams): Promise<GapiResponse<T>> => {
  const requestFn = getPageGlobal('gapi.client.request') as
    | ((args: GapiRequestParams) => {
        then: (ok: (response: GapiResponse<T>) => void, err: (error: GapiResponse<T>) => void) => void;
      })
    | undefined;

  if (!requestFn) {
    throw ToolError.auth('Google Docs is not ready — please open Google Docs and sign in.');
  }

  ensureApiKey();

  const cleanParams = opts.params
    ? (Object.fromEntries(Object.entries(opts.params).filter(([, value]) => value !== undefined)) as Record<
        string,
        string | number | boolean
      >)
    : undefined;

  return new Promise<GapiResponse<T>>((resolve, reject) => {
    requestFn({ ...opts, params: cleanParams }).then(resolve, reject);
  });
};

const classifyGapiError = (endpoint: string, err: unknown): never => {
  const gapiError = err as GapiResponse<{ error?: { code?: number; message?: string } }>;
  const status = gapiError?.status;
  const message = gapiError?.result?.error?.message ?? `API error: ${endpoint}`;

  if (status === 401 || status === 403) throw ToolError.auth(message);
  if (status === 404) throw ToolError.notFound(message);
  if (status === 429) throw ToolError.rateLimited(message);
  if (status === 400 || status === 422) throw ToolError.validation(message);
  throw ToolError.internal(`(${status ?? 'unknown'}) ${message}`);
};

const callApi = async <T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  try {
    const response = await gapiRequest<T>({
      path,
      method: options.method,
      params: options.params,
      body: serializeRequestBody(options.body),
    });
    return response.result;
  } catch (err: unknown) {
    return classifyGapiError(path, err);
  }
};

export const isAuthenticated = (): boolean => isGapiReady() && !!getCookie('SAPISID');

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 8000 }).then(
    () => true,
    () => false,
  );

export const driveApi = <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => callApi<T>(`${DRIVE_API_BASE}${endpoint}`, options);

export const driveApiRaw = async (
  endpoint: string,
  options: {
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<string> => {
  try {
    const response = await gapiRequest<unknown>({
      path: `${DRIVE_API_BASE}${endpoint}`,
      params: options.params,
    });
    return response.body;
  } catch (err: unknown) {
    return classifyGapiError(endpoint, err);
  }
};

export const driveApiVoid = async (
  endpoint: string,
  options: {
    method?: string;
    params?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<void> => {
  try {
    await gapiRequest<unknown>({
      path: `${DRIVE_API_BASE}${endpoint}`,
      method: options.method,
      params: options.params,
    });
  } catch (err: unknown) {
    const gapiError = err as GapiResponse<{ error?: { code?: number; message?: string } }>;
    if (gapiError?.status === 204) return;
    classifyGapiError(endpoint, err);
  }
};

export const getCurrentDocumentContext = (): CurrentDocumentContext | null => {
  const url = getCurrentUrl();
  const parsedUrl = new URL(url);
  const match = parsedUrl.pathname.match(/\/document\/d\/([^/]+)/);
  if (!match) return null;
  const encodedDocumentId = match[1];
  if (!encodedDocumentId) return null;

  return {
    documentId: decodeURIComponent(encodedDocumentId),
    tabId: parsedUrl.searchParams.get('tab') ?? '',
    title: getPageTitle() ?? '',
    url,
  };
};

export const resolveDocumentId = (explicitDocumentId?: string): string => {
  if (explicitDocumentId) return explicitDocumentId;

  const current = getCurrentDocumentContext();
  if (current?.documentId) return current.documentId;

  throw ToolError.validation('No document ID found — provide document_id or open a Google Doc in the current tab.');
};

export const getDocumentFile = (documentId: string): Promise<RawDriveFile> =>
  driveApi<RawDriveFile>(`/files/${encodeURIComponent(documentId)}`, {
    params: { fields: DOCUMENT_FIELDS },
  });
