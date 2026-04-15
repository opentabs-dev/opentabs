import { ToolError, getPageGlobal, waitUntil } from '@opentabs-dev/plugin-sdk';

const API_BASE = 'https://api.stackexchange.com/2.3';
const SITE = 'stackoverflow';
const FILTER = 'withbody';

/** Returns the authenticated user's ID, or null if not logged in. */
const getUserId = (): number | null => {
  try {
    const isRegistered = getPageGlobal('StackExchange.options.user.isRegistered');
    if (!isRegistered) return null;
    const userId = getPageGlobal('StackExchange.options.user.userId');
    if (typeof userId !== 'number') return null;
    return userId;
  } catch {
    return null;
  }
};

export const isAuthenticated = (): boolean => getUserId() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

export const getCurrentUserId = (): number => {
  const id = getUserId();
  if (!id) throw ToolError.auth('Not authenticated — please log in to Stack Overflow.');
  return id;
};

/** Calls the Stack Exchange API v2.3. Appends site=stackoverflow and filter=withbody by default. */
export const api = async (
  endpoint: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<SEResponse> => {
  const params = new URLSearchParams();
  params.append('site', SITE);

  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== '') params.append(k, String(v));
    }
  }

  if (!options.query?.filter) {
    params.append('filter', FILTER);
  }

  const url = `${API_BASE}${endpoint}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw ToolError.timeout(`Timed out: ${endpoint}`);
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  const text = await response.text();
  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (body && typeof body.error_id === 'number') {
    const msg = `${body.error_name}: ${body.error_message}`;
    if (body.error_id === 502) throw ToolError.rateLimited(msg);
    if (body.error_id === 401 || body.error_id === 403) throw ToolError.auth(msg);
    if (body.error_id === 404) throw ToolError.notFound(msg);
    if (body.error_id === 400) throw ToolError.validation(msg);
    throw ToolError.internal(`API error (${body.error_id}): ${msg}`);
  }

  if (!response.ok) {
    throw ToolError.internal(`HTTP ${response.status}: ${endpoint}`);
  }

  if (!body) {
    throw ToolError.internal(`Invalid JSON response from ${endpoint}`);
  }

  if (typeof body.backoff === 'number') {
    throw ToolError.rateLimited(`API requested backoff of ${body.backoff}s for ${endpoint}`, body.backoff * 1000);
  }

  return body as unknown as SEResponse;
};

export interface SEResponse {
  // biome-ignore lint/suspicious/noExplicitAny: SE API returns untyped JSON
  items: Record<string, any>[];
  has_more: boolean;
  quota_remaining: number;
}
