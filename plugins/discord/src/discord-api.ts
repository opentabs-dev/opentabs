import {
  clearAuthCache,
  getAuthCache,
  parseRetryAfterMs,
  setAuthCache,
  ToolError,
  waitUntil,
} from '@opentabs-dev/plugin-sdk';

interface DiscordAuth {
  token: string;
}

/**
 * Extract the auth token from Discord's webpack module registry.
 * Discord keeps the token in an internal module that exposes a `getToken()`
 * method. We push a one-shot chunk into `webpackChunkdiscord_app` to walk
 * the module cache and find it. Many i18n modules also have `getToken()`
 * (returning `{locale, ast}`), so we filter by return type — only a string
 * result is the auth token.
 */
const getTokenFromWebpack = (): string | null => {
  try {
    const chunks = (globalThis as Record<string, unknown>).webpackChunkdiscord_app as
      | { push(entry: unknown): void }
      | undefined;
    if (!chunks) return null;

    let token: string | null = null;
    chunks.push([
      [Symbol()],
      {},
      (require: { c: Record<string, { exports?: Record<string, unknown> }> }) => {
        // Guard: require.c can become null/undefined mid-iteration when the
        // push mutates Discord's internal chunk array. Snapshot the values
        // before iterating so a concurrent modification doesn't crash the loop.
        let modules: { exports?: Record<string, unknown> }[];
        try {
          modules = Object.values(require.c ?? {});
        } catch {
          return;
        }
        for (const mod of modules) {
          try {
            const exports = mod?.exports;
            if (!exports) continue;
            const def = (exports.default ?? exports) as Record<string, unknown>;
            if (typeof def?.getToken !== 'function') continue;
            const result: unknown = (def.getToken as () => unknown)();
            if (typeof result === 'string' && result.length > 0) {
              token = result;
              break;
            }
          } catch {
            // Individual module access can throw; skip and continue.
            continue;
          }
        }
      },
    ]);
    return token;
  } catch {
    return null;
  }
};

/**
 * Extract auth token from Discord. Checks two sources in order:
 * 1. Persisted cache on globalThis (survives adapter re-injection)
 * 2. Discord's internal webpack module registry via `getToken()`
 *
 * Once extracted, the token is cached on globalThis so subsequent calls
 * avoid the webpack walk.
 */
const getAuth = (): DiscordAuth | null => {
  const persisted = getAuthCache<string>('discord');
  if (persisted) return { token: persisted };

  const token = getTokenFromWebpack();
  if (!token) return null;

  setAuthCache('discord', token);
  return { token };
};

export const isDiscordAuthenticated = (): boolean => getAuth() !== null;

/**
 * Wait for Discord's SPA to hydrate and populate its internal token manager.
 * Polls at 500ms intervals for up to 10 seconds.
 */
export const waitForDiscordAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isDiscordAuthenticated(), { interval: 500, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};

// Discord API error codes that map to specific error categories
const AUTH_ERRORS = new Set([
  0, // General auth failure
  40001, // Unauthorized
  40002, // Verification required
  50014, // Invalid authentication token
]);

const NOT_FOUND_ERRORS = new Set([
  10003, // Unknown Channel
  10004, // Unknown Guild
  10006, // Unknown Invite
  10008, // Unknown Message
  10013, // Unknown User
  10011, // Unknown Role
  10014, // Unknown Emoji
  10015, // Unknown Webhook
]);

const VALIDATION_ERRORS = new Set([
  50001, // Missing Access
  50003, // Cannot execute on DM channel
  50006, // Cannot send empty message
  50007, // Cannot send messages to this user
  50008, // Cannot edit message by another user
  50013, // Missing Permissions
  50035, // Invalid Form Body
  50109, // Request body contains invalid JSON
]);

/**
 * Make an authenticated request to the Discord API (v9).
 * Automatically extracts the token and handles error classification.
 */
export const discordApi = async <T extends Record<string, unknown>>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | FormData;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) {
    throw ToolError.auth('Not authenticated — no Discord token found. Please log in to Discord.');
  }

  const { method = 'GET', body, query } = options;

  let url = `https://discord.com/api/v9${endpoint}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: auth.token,
  };

  let fetchBody: string | FormData | undefined;
  if (body instanceof FormData) {
    fetchBody = body;
    // Do not set Content-Type for FormData — browser sets multipart boundary
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw ToolError.timeout(`Discord API request timed out: ${method} ${endpoint}`);
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ToolError('Request was aborted', 'aborted');
    }
    throw new ToolError(
      `Network error calling Discord API: ${err instanceof Error ? err.message : String(err)}`,
      'network_error',
      { category: 'internal', retryable: true },
    );
  }

  // Handle HTTP-level errors
  if (!response.ok) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryMs = retryAfterHeader !== null ? parseRetryAfterMs(retryAfterHeader) : undefined;
    const errorText = await response.text().catch(() => '');
    const errorBody = errorText.substring(0, 512);

    if (response.status === 429) {
      let retryAfterMs = retryMs;
      try {
        const parsed = JSON.parse(errorText) as { retry_after?: number };
        if (typeof parsed.retry_after === 'number') {
          retryAfterMs = parsed.retry_after * 1000;
        }
      } catch {
        // Use header value
      }
      throw ToolError.rateLimited(`Discord API rate limited: ${method} ${endpoint} — ${errorBody}`, retryAfterMs);
    }
    // Parse error body for Discord-specific error codes before classifying by HTTP status.
    // Discord uses 403 for both "unauthorized" and "missing permissions" — the error code
    // in the response body distinguishes them.
    let discordCode: number | undefined;
    let discordMessage: string | undefined;
    try {
      const parsed = JSON.parse(errorText) as { code?: number; message?: string };
      discordCode = parsed.code;
      discordMessage = parsed.message;
    } catch {
      // Not JSON — classify by HTTP status only
    }

    if (discordCode !== undefined) {
      if (VALIDATION_ERRORS.has(discordCode)) {
        throw ToolError.validation(`Discord API error: ${discordMessage ?? errorBody} (code ${String(discordCode)})`);
      }
      if (NOT_FOUND_ERRORS.has(discordCode)) {
        throw ToolError.notFound(`Discord API error: ${discordMessage ?? errorBody} (code ${String(discordCode)})`);
      }
      if (AUTH_ERRORS.has(discordCode)) {
        clearAuthCache('discord');
        throw ToolError.auth(`Discord API error: ${discordMessage ?? errorBody} (code ${String(discordCode)})`);
      }
    }

    if (response.status === 401 || response.status === 403) {
      clearAuthCache('discord');
      throw ToolError.auth(`Discord API auth error (${String(response.status)}): ${errorBody}`);
    }
    if (response.status === 404) {
      throw ToolError.notFound(`Discord API not found: ${method} ${endpoint} — ${errorBody}`);
    }
    throw ToolError.internal(`Discord API error (${String(response.status)}): ${method} ${endpoint} — ${errorBody}`);
  }

  // 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw ToolError.internal(`Discord API returned invalid JSON: ${method} ${endpoint}`);
  }

  // Discord API-level errors (some endpoints return 200 with error codes in body)
  if (typeof data === 'object' && data !== null && 'code' in data && 'message' in data) {
    const record = data as { code: number; message: string };
    if (AUTH_ERRORS.has(record.code)) {
      throw ToolError.auth(`Discord API error: ${record.message} (code ${String(record.code)})`);
    }
    if (NOT_FOUND_ERRORS.has(record.code)) {
      throw ToolError.notFound(`Discord API error: ${record.message} (code ${String(record.code)})`);
    }
    if (VALIDATION_ERRORS.has(record.code)) {
      throw ToolError.validation(`Discord API error: ${record.message} (code ${String(record.code)})`);
    }
  }

  return data as T;
};
