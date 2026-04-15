import { ToolError, fetchFromPage, buildQueryString, getCookie, waitUntil } from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

const IG_APP_ID = '936619743392459';

// Always read CSRF token fresh from the cookie — Instagram rotates it.
// Only the user ID is stable and used for isAuthenticated checks.

export const isAuthenticated = (): boolean => {
  const csrfToken = getCookie('csrftoken');
  const userId = getCookie('ds_user_id');
  return !!csrfToken && !!userId;
};

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getCurrentUserId = (): string => {
  const userId = getCookie('ds_user_id');
  if (!userId) throw ToolError.auth('Not authenticated — please log in to Instagram.');
  return userId;
};

const getHeaders = (): Record<string, string> => {
  const csrfToken = getCookie('csrftoken');
  if (!csrfToken) throw ToolError.auth('Not authenticated — please log in to Instagram.');
  return {
    'X-CSRFToken': csrfToken,
    'X-IG-App-ID': IG_APP_ID,
    'X-Requested-With': 'XMLHttpRequest',
  };
};

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | string;
    query?: Record<string, string | number | boolean | undefined>;
    formEncoded?: boolean;
  } = {},
): Promise<T> => {
  const headers = getHeaders();
  const method = options.method ?? 'GET';

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `/api/v1${endpoint}?${qs}` : `/api/v1${endpoint}`;

  const init: FetchFromPageOptions = { method, headers };

  if (options.body) {
    if (options.formEncoded || typeof options.body === 'string') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body =
        typeof options.body === 'string'
          ? options.body
          : new URLSearchParams(options.body as Record<string, string>).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }

  let response: Response;
  try {
    response = await fetchFromPage(url, init);
  } catch (err: unknown) {
    if (err instanceof ToolError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`Request timed out: ${endpoint}`);
    }
    throw ToolError.internal(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 204) return {} as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw ToolError.internal(`Unexpected content type for ${endpoint}: ${contentType}`);
  }

  return (await response.json()) as T;
};
