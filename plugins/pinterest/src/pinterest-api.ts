import { ToolError, fetchFromPage, getCookie, waitUntil } from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Auth ---

const getCsrfToken = (): string | null => getCookie('csrftoken');

export const isAuthenticated = (): boolean => getCsrfToken() !== null && getCookie('_pinterest_sess') !== null;

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

// --- App version ---

const getAppVersion = (): string => {
  const scripts = document.querySelectorAll('script');
  for (const s of scripts) {
    const text = s.textContent;
    if (text?.includes('app_version')) {
      const match = text.match(/"app_version"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
  }
  return '';
};

// --- Common headers ---

const buildHeaders = (sourceUrl: string): Record<string, string> => {
  const csrf = getCsrfToken();
  if (!csrf) throw ToolError.auth('Not authenticated — please log in to Pinterest.');

  return {
    Accept: 'application/json, text/javascript, */*, q=0.01',
    'X-CSRFToken': csrf,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Pinterest-AppState': 'active',
    'X-Pinterest-PWS-Handler': 'www/index.js',
    'X-Pinterest-Source-Url': sourceUrl,
    'X-APP-VERSION': getAppVersion(),
  };
};

// --- Resource API ---

interface ResourceOptions {
  [key: string]: unknown;
}

interface ResourceResponse<T> {
  resource_response: {
    status?: string;
    http_status?: number;
    data: T;
    bookmark?: string;
    error?: { status?: string; http_status?: number; code?: number; message?: string };
  };
  resource?: {
    options?: { bookmarks?: string[] };
  };
  client_context?: {
    user?: Record<string, unknown>;
    is_authenticated?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Call a Pinterest resource GET endpoint.
 * Data is passed as query parameters: `source_url=...&data=<JSON>`.
 */
export const resourceGet = async <T>(
  resource: string,
  options: ResourceOptions,
  sourceUrl = '/',
  bookmark?: string,
): Promise<ResourceResponse<T>> => {
  const opts: ResourceOptions = { ...options };
  if (bookmark) {
    opts.bookmarks = [bookmark];
  }

  const data = encodeURIComponent(JSON.stringify({ options: opts, context: {} }));
  const url = `/resource/${resource}/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${data}`;

  const headers = buildHeaders(sourceUrl);
  const resp = await fetchFromPage(url, { headers });
  const json = (await resp.json()) as ResourceResponse<T>;

  const err = json.resource_response?.error;
  if (err) {
    const status = err.http_status ?? resp.status;
    const msg = err.message ?? 'Pinterest API error';
    if (status === 401 || status === 403) throw ToolError.auth(msg);
    if (status === 404) throw ToolError.notFound(msg);
    if (status === 429) throw ToolError.rateLimited(msg);
    throw ToolError.internal(msg);
  }

  return json;
};

/**
 * Call a Pinterest resource POST endpoint (create/update/delete).
 * Data is sent as form-encoded body: `source_url=...&data=<JSON>`.
 */
export const resourcePost = async <T>(
  resource: string,
  action: 'create' | 'update' | 'delete',
  options: ResourceOptions,
  sourceUrl = '/',
): Promise<ResourceResponse<T>> => {
  const url = `/resource/${resource}/${action}/`;
  const headers = buildHeaders(sourceUrl);
  headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const body = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify({ options, context: {} }),
  }).toString();

  const init: FetchFromPageOptions = {
    method: 'POST',
    headers,
    body,
  };

  const resp = await fetchFromPage(url, init);
  const json = (await resp.json()) as ResourceResponse<T>;

  const err = json.resource_response?.error;
  if (err) {
    const status = err.http_status ?? resp.status;
    const msg = err.message ?? 'Pinterest API error';
    if (status === 401 || status === 403) throw ToolError.auth(msg);
    if (status === 404) throw ToolError.notFound(msg);
    if (status === 429) throw ToolError.rateLimited(msg);
    throw ToolError.internal(msg);
  }

  return json;
};

/**
 * Extract the bookmark (pagination cursor) from a resource response.
 */
export const getBookmark = <T>(response: ResourceResponse<T>): string => {
  return response.resource?.options?.bookmarks?.[0] ?? response.resource_response?.bookmark ?? '';
};
