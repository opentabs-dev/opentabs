import {
  getAuthCache,
  getMetaContent,
  parseRetryAfterMs,
  setAuthCache,
  ToolError,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

interface JiraAuth {
  accountId: string;
  cloudId: string;
}

const getAuth = (): JiraAuth | null => {
  const persisted = getAuthCache<JiraAuth>('jira');
  if (persisted) return persisted;

  const accountId = getMetaContent('ajs-atlassian-account-id');
  const cloudId = getMetaContent('ajs-cloud-id');

  if (!accountId || !cloudId) return null;

  const auth: JiraAuth = { accountId, cloudId };
  setAuthCache('jira', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    rawBody?: string;
    query?: Record<string, string | number | boolean | undefined>;
    basePath?: string;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Jira.');

  const base = options.basePath ?? '/rest/api/3';
  let url = `${base}${endpoint}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  let fetchBody: string | undefined;
  if (options.rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = options.rawBody;
  } else if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === 'AbortError') throw ToolError.timeout('Request was aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    if (response.status === 400) {
      throw ToolError.validation(`Bad request: ${endpoint} — ${errorBody}`);
    }
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
};
