import {
  ToolError,
  clearAuthCache,
  findLocalStorageEntry,
  getAuthCache,
  getCookie,
  getLocalStorage,
  parseRetryAfterMs,
  setAuthCache,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface NotionAuth {
  userId: string;
  spaceId: string;
}

// --- Auth extraction ---

const getAuth = (): NotionAuth | null => {
  const persisted = getAuthCache<NotionAuth>('notion');
  if (persisted) return persisted;

  // Extract userId from notion_user_id cookie
  const userId = getCookie('notion_user_id');
  if (!userId) return null;

  // Extract spaceId from localStorage
  const spaceId = getSpaceIdFromLocalStorage();
  if (!spaceId) {
    // Return auth with just userId; spaceId will be resolved on first API call
    const auth: NotionAuth = { userId, spaceId: '' };
    setAuthCache('notion', auth);
    return auth;
  }

  const auth: NotionAuth = { userId, spaceId };
  setAuthCache('notion', auth);
  return auth;
};

const getSpaceIdFromLocalStorage = (): string | null => {
  try {
    const lastVisitedRoute = getLocalStorage('LRU:KeyValueStore2:lastVisitedRouteSpaceId');
    if (lastVisitedRoute) {
      // LRU format: JSON with value field
      const parsed = JSON.parse(lastVisitedRoute) as { value?: string };
      if (parsed.value) return parsed.value;
    }
  } catch {}

  const entry = findLocalStorageEntry(key => key.includes('spaceId'));
  if (entry) {
    try {
      const parsed = JSON.parse(entry.value) as { value?: string };
      if (parsed.value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/)) return parsed.value;
    } catch {
      if (entry.value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/)) return entry.value;
    }
  }

  return null;
};

// --- Public auth functions ---

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(
    () => true,
    () => false,
  );

// --- Resolve spaceId if missing ---

const resolveSpaceId = async (auth: NotionAuth): Promise<string> => {
  if (auth.spaceId) return auth.spaceId;

  // Call getSpaces to discover the user's space
  const data = await notionApi<Record<string, { space?: Record<string, { value?: { id: string } }> }>>('getSpaces', {});
  const userSpaces = data[auth.userId];
  if (userSpaces?.space) {
    const firstSpaceId = Object.keys(userSpaces.space)[0];
    if (firstSpaceId) {
      auth.spaceId = firstSpaceId;
      setAuthCache('notion', auth);
      return firstSpaceId;
    }
  }
  throw ToolError.auth('Could not determine workspace — please reload the page.');
};

// --- API caller ---

export const notionApi = async <T>(endpoint: string, body: Record<string, unknown>): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Notion.');

  const url = `https://www.notion.so/api/v3/${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add Notion-specific headers for write operations
  if (auth.userId) {
    headers['x-notion-active-user-header'] = auth.userId;
  }
  if (auth.spaceId) {
    headers['x-notion-space-id'] = auth.spaceId;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw ToolError.timeout(`API request timed out: ${endpoint}`);
    if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  if (!response.ok) {
    const errorText = (await response.text().catch(() => '')).substring(0, 512);

    // Clear persisted auth on 401
    if (response.status === 401) {
      clearAuthCache('notion');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter !== null ? parseRetryAfterMs(retryAfter) : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorText}`, retryMs);
    }
    if (response.status === 401 || response.status === 403)
      throw ToolError.auth(`Auth error (${response.status}): ${errorText}`);
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorText}`);

    // Parse Notion-specific error codes from body
    try {
      const parsed = JSON.parse(errorText) as { name?: string; message?: string; debugMessage?: string };
      if (parsed.name === 'ValidationError') {
        throw ToolError.validation(`Validation error: ${parsed.debugMessage ?? parsed.message ?? errorText}`);
      }
    } catch (parseErr) {
      if (parseErr instanceof ToolError) throw parseErr;
    }

    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorText}`);
  }

  if (response.status === 204) return {} as T;

  // Some Notion endpoints return HTML on error (404 routes)
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw ToolError.internal(`Unexpected response type (${contentType}) from ${endpoint}`);
  }

  return (await response.json()) as T;
};

// --- Convenience: ensure spaceId is resolved ---

export const getSpaceId = async (): Promise<string> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Notion.');
  return resolveSpaceId(auth);
};

export const getUserId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Notion.');
  return auth.userId;
};
