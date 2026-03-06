import { ToolError, parseRetryAfterMs } from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface NotionAuth {
  userId: string;
  spaceId: string;
}

// --- Token persistence via globalThis (survives adapter re-injection) ---

const getPersistedAuth = (): NotionAuth | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, string | undefined> | undefined;
    const raw = cache?.notion;
    if (!raw) return null;
    return JSON.parse(raw) as NotionAuth;
  } catch {
    return null;
  }
};

const setPersistedAuth = (auth: NotionAuth): void => {
  try {
    const g = globalThis as Record<string, unknown>;
    if (!g.__openTabs) g.__openTabs = {};
    const ns = g.__openTabs as Record<string, unknown>;
    if (!ns.tokenCache) ns.tokenCache = {};
    const cache = ns.tokenCache as Record<string, string | undefined>;
    cache.notion = JSON.stringify(auth);
  } catch {}
};

const clearPersistedAuth = (): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, string | undefined> | undefined;
    if (cache) cache.notion = undefined;
  } catch {}
};

// --- Auth extraction ---

const getAuth = (): NotionAuth | null => {
  const persisted = getPersistedAuth();
  if (persisted) return persisted;

  // Extract userId from notion_user_id cookie
  const userId = getCookie('notion_user_id');
  if (!userId) return null;

  // Extract spaceId from localStorage
  const spaceId = getSpaceIdFromLocalStorage();
  if (!spaceId) {
    // Return auth with just userId; spaceId will be resolved on first API call
    const auth: NotionAuth = { userId, spaceId: '' };
    setPersistedAuth(auth);
    return auth;
  }

  const auth: NotionAuth = { userId, spaceId };
  setPersistedAuth(auth);
  return auth;
};

const getCookie = (name: string): string | null => {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};

const getSpaceIdFromLocalStorage = (): string | null => {
  try {
    const lastVisitedRoute = localStorage.getItem('LRU:KeyValueStore2:lastVisitedRouteSpaceId');
    if (lastVisitedRoute) {
      // LRU format: JSON with value field
      const parsed = JSON.parse(lastVisitedRoute) as { value?: string };
      if (parsed.value) return parsed.value;
    }
  } catch {}

  try {
    // Scan localStorage for spaceId patterns
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.includes('spaceId')) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val) as { value?: string };
            if (parsed.value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/)) {
              return parsed.value;
            }
          } catch {
            if (val.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/)) return val;
          }
        }
      }
    }
  } catch {}

  return null;
};

// --- Public auth functions ---

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isAuthenticated()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (elapsed >= maxWait) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });

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
      setPersistedAuth(auth);
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
      clearPersistedAuth();
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
