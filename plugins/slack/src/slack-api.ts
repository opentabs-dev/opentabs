import { ToolError } from '@opentabs-dev/plugin-sdk';

/**
 * Slack authentication extracted from the web client's runtime state.
 */
interface SlackAuth {
  token: string;
  workspaceUrl: string;
  teamId: string;
}

/**
 * Shape of Slack's localConfig_v2 localStorage entry (old client).
 */
interface LocalConfigV2 {
  teams?: Record<string, { token: string; url: string; name: string }>;
  lastActiveTeamId?: string;
}

/**
 * Shape of Slack's boot_data global (new app.slack.com client).
 */
interface SlackBootData {
  api_token?: string;
  team_id?: string;
  team_url?: string;
  [key: string]: unknown;
}

/**
 * Try to read auth from localStorage (old Slack client at WORKSPACE.slack.com).
 * The old client stores workspace config in `localConfig_v2` which includes
 * the `xoxc-` session token for each workspace.
 */
const getAuthFromLocalStorage = (): SlackAuth | null => {
  try {
    const candidates = ['localConfig_v2', 'localConfig_v3'];
    let raw: string | null = null;
    for (const key of candidates) {
      raw = localStorage.getItem(key);
      if (raw) break;
    }
    if (!raw) return null;

    const config = JSON.parse(raw) as LocalConfigV2;
    if (!config.teams) return null;

    const teamId = config.lastActiveTeamId ?? Object.keys(config.teams)[0];
    if (!teamId) return null;

    const team = config.teams[teamId];
    if (!team?.token) return null;

    return buildAuth(team.token, teamId, undefined);
  } catch {
    return null;
  }
};

/**
 * Shape of the window.TS global exposed by the Slack web client.
 * Different client versions populate different subsets of this object.
 */
interface SlackTSGlobal {
  boot_data?: SlackBootData;
  model?: {
    api_token?: string;
    team?: { id?: string; url?: string; domain?: string };
    [key: string]: unknown;
  };
  redux?: {
    getState?: () => { boot?: SlackBootData; [key: string]: unknown };
  };
  [key: string]: unknown;
}

/**
 * Build a SlackAuth from a token string and optional team metadata.
 * Centralizes the fallback logic for workspace URL and team ID.
 */
const buildAuth = (token: string, teamId?: string, teamUrl?: string): SlackAuth => {
  let url = (teamUrl ?? '').replace(/\/$/, '') || window.location.origin;
  // Upgrade HTTP to HTTPS to prevent sending tokens over unencrypted connections
  url = url.replace(/^http:\/\//i, 'https://');
  return { token, workspaceUrl: url, teamId: teamId ?? '' };
};

/**
 * Try to extract auth from a SlackBootData-shaped object.
 * Returns null if the object does not contain a valid xoxc- token.
 */
const authFromBootData = (bd: SlackBootData | null | undefined): SlackAuth | null => {
  if (!bd?.api_token || typeof bd.api_token !== 'string') return null;
  if (!bd.api_token.startsWith('xoxc-')) return null;
  return buildAuth(
    bd.api_token,
    typeof bd.team_id === 'string' ? bd.team_id : undefined,
    typeof bd.team_url === 'string' ? bd.team_url : undefined,
  );
};

/**
 * Try to read auth from window globals set by the Slack web client.
 * The Slack client exposes authentication state through several global
 * objects depending on the client version:
 *   - window.boot_data (SSR-injected on app.slack.com)
 *   - window.TS.boot_data (classic client)
 *   - window.TS.model.api_token (classic client model layer)
 *   - window.TS.redux.getState().boot (Redux store, some client versions)
 */
const getAuthFromBootData = (): SlackAuth | null => {
  try {
    const g = globalThis as Record<string, unknown>;

    // 1. window.boot_data (SSR-injected by app.slack.com)
    const directBoot = authFromBootData(g.boot_data as SlackBootData | undefined);
    if (directBoot) return directBoot;

    const ts = g.TS as SlackTSGlobal | undefined;
    if (!ts) return null;

    // 2. window.TS.boot_data (classic client)
    const tsBoot = authFromBootData(ts.boot_data);
    if (tsBoot) return tsBoot;

    // 3. window.TS.model.api_token (classic client model layer)
    if (ts.model) {
      const modelToken = ts.model.api_token;
      if (typeof modelToken === 'string' && modelToken.startsWith('xoxc-')) {
        return buildAuth(
          modelToken,
          ts.model.team?.id,
          ts.model.team?.url ?? (ts.model.team?.domain ? `https://${ts.model.team.domain}.slack.com` : undefined),
        );
      }
    }

    // 4. window.TS.redux.getState().boot (Redux store)
    if (typeof ts.redux?.getState === 'function') {
      const state = ts.redux.getState();
      const reduxBoot = authFromBootData(state?.boot as SlackBootData | undefined);
      if (reduxBoot) return reduxBoot;
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Try to extract auth from a script tag's text content using regex.
 * Searches for xoxc- tokens in JSON-like contexts within the text.
 */
const extractAuthFromScriptText = (text: string): SlackAuth | null => {
  // Match xoxc- tokens in any JSON-like context (handles both quoted keys and unquoted)
  const tokenMatch = /["']?api_token["']?\s*:\s*["'](xoxc-[a-zA-Z0-9_-]+)["']/.exec(text);
  if (!tokenMatch?.[1]) return null;

  const token = tokenMatch[1];

  // Extract team_id from the same script block
  const teamIdMatch = /["']?team_id["']?\s*:\s*["'](T[A-Z0-9]+)["']/.exec(text);
  const teamId = teamIdMatch?.[1] ?? '';

  // Extract team_url from the same script block
  const teamUrlMatch = /["']?team_url["']?\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(text);
  const teamUrl = teamUrlMatch?.[1]?.replace(/\/$/, '') ?? '';

  return buildAuth(token, teamId || undefined, teamUrl || undefined);
};

/**
 * Try to read auth from inline `<script>` tags in the page HTML.
 * The Slack web client embeds configuration JSON in script tags during
 * server-side rendering. Checks both executable scripts and JSON data
 * scripts (type="application/json"), as different client versions use
 * different approaches.
 */
const getAuthFromPageScripts = (): SlackAuth | null => {
  try {
    // Check all inline scripts: both executable and JSON data scripts
    const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent;
      if (!text || !text.includes('xoxc-')) continue;

      // For JSON scripts, try parsing the entire content as JSON first
      if (script.type === 'application/json' || script.type === 'application/ld+json') {
        try {
          const parsed: unknown = JSON.parse(text);
          const auth = extractAuthFromObject(parsed);
          if (auth) return auth;
        } catch {
          // Fall through to regex extraction
        }
      }

      const auth = extractAuthFromScriptText(text);
      if (auth) return auth;
    }

    // Check data attributes on the HTML element — some Slack versions embed
    // boot data as a JSON attribute (e.g., data-boot on the root element)
    const htmlEl = document.documentElement;
    const bootAttr = htmlEl.getAttribute('data-boot');
    if (bootAttr?.includes('xoxc-')) {
      try {
        const parsed: unknown = JSON.parse(bootAttr);
        const auth = extractAuthFromObject(parsed);
        if (auth) return auth;
      } catch {
        const auth = extractAuthFromScriptText(bootAttr);
        if (auth) return auth;
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Scan all localStorage keys for Slack auth tokens.
 * The Slack web client may store tokens under key names that vary across
 * versions. This brute-force scans all keys and parses any JSON values
 * or raw strings that contain xoxc- tokens.
 */
const getAuthFromLocalStorageScan = (): SlackAuth | null => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // Skip keys already handled by getAuthFromLocalStorage
      if (key === 'localConfig_v2' || key === 'localConfig_v3') continue;

      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes('xoxc-')) continue;

      // Try to parse as JSON and extract token
      try {
        const parsed: unknown = JSON.parse(raw);
        const auth = extractAuthFromObject(parsed);
        if (auth) return auth;
      } catch {
        // Not JSON — try regex extraction from raw string
        const tokenMatch = /(xoxc-[a-zA-Z0-9-]+)/.exec(raw);
        if (tokenMatch?.[1]) {
          return buildAuth(tokenMatch[1]);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Recursively search a parsed JSON object for Slack auth fields
 * (`api_token` or `token` containing an xoxc- value). Searches objects
 * and arrays up to 3 levels deep to handle nested config structures
 * while avoiding excessive recursion on large Slack state objects.
 */
const extractAuthFromObject = (obj: unknown, depth = 0): SlackAuth | null => {
  if (depth > 3 || typeof obj !== 'object' || obj === null) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = extractAuthFromObject(item, depth + 1);
      if (result) return result;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;

  // Check for api_token or token fields directly
  const tokenCandidate = record.api_token ?? record.token;
  if (typeof tokenCandidate === 'string' && tokenCandidate.startsWith('xoxc-')) {
    return buildAuth(
      tokenCandidate,
      typeof record.team_id === 'string' ? record.team_id : undefined,
      typeof record.team_url === 'string' ? record.team_url : undefined,
    );
  }

  // Recurse into object values
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      const result = extractAuthFromObject(value, depth + 1);
      if (result) return result;
    }
  }

  return null;
};

/**
 * Read Slack auth credentials from the web client's runtime state.
 * Tries multiple sources in order of reliability to support both old
 * (WORKSPACE.slack.com) and new (app.slack.com) Slack clients:
 *   1. localStorage `localConfig_v2` / `localConfig_v3` (legacy client)
 *   2. `window.boot_data` / `window.TS.boot_data` globals
 *   3. Inline `<script>` tags with embedded config JSON
 *   4. Full localStorage scan for any key containing an xoxc- token
 */
const getAuth = (): SlackAuth | null =>
  getAuthFromLocalStorage() ??
  getAuthFromBootData() ??
  getAuthFromPageScripts() ??
  getAuthFromLocalStorageScan();

/**
 * Check if the current Slack session is authenticated.
 * Returns true if a valid token can be found from any source.
 */
const isSlackAuthenticated = (): boolean => getAuth() !== null;

/**
 * Wait for Slack auth data to become available, retrying at short intervals.
 * The app.slack.com SPA hydrates asynchronously after the page's
 * `status=complete` event, so auth globals (window.boot_data, window.TS)
 * may not be populated on the first check. This polls at 500ms intervals
 * for up to 3 seconds — well within the 5-second isReady() timeout
 * enforced by the browser extension.
 */
const waitForSlackAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 3000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isSlackAuthenticated()) {
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

/**
 * Call a Slack Web API method with proper authentication.
 *
 * Uses the session token from the page's runtime state and sends it as a
 * form-encoded body parameter, matching how the Slack web client makes
 * API calls. Includes Slack's internal request metadata headers
 * (`_x_reason`, `_x_mode`, etc.) for compatibility.
 *
 * @typeParam T - Expected shape of the successful response (excluding `ok` and `error`)
 * @param method - Slack API method name (e.g., `chat.postMessage`, `conversations.list`)
 * @param params - API parameters as key-value pairs
 * @returns The parsed JSON response, typed as `T & { ok: true }`
 * @throws {ToolError} If not authenticated, or if the API returns `ok: false`
 */
const slackApi = async <T extends Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T & { ok: true }> => {
  const auth = getAuth();
  if (!auth) {
    throw new ToolError('Not authenticated — no Slack session token found', 'not_authed');
  }

  const form = new URLSearchParams();
  form.append('token', auth.token);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean));
    }
  }

  form.append('_x_reason', 'api_call');
  form.append('_x_mode', 'online');
  form.append('_x_sonic', 'true');
  form.append('_x_app_name', 'client');
  if (auth.teamId) {
    form.append('_x_team_id', auth.teamId);
  }

  if (!auth.workspaceUrl.startsWith('https://')) {
    throw new ToolError('HTTPS required for Slack API calls', 'insecure_connection');
  }

  const response = await fetch(`${auth.workspaceUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    credentials: 'include',
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') ?? 'unknown';
    throw new ToolError(`Slack API rate limited (429). Retry after ${retryAfter} seconds.`, 'rate_limited');
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new ToolError(`Slack API HTTP ${response.status}: ${errorText}`, 'http_error');
  }

  const data: unknown = await response.json();

  if (typeof data !== 'object' || data === null) {
    throw new ToolError('Invalid API response format', 'invalid_response');
  }

  const record = data as Record<string, unknown>;
  if (record.ok !== true) {
    const error = typeof record.error === 'string' ? record.error : 'unknown_error';
    throw new ToolError(`Slack API error: ${error}`, error);
  }

  return data as T & { ok: true };
};

export { isSlackAuthenticated, waitForSlackAuth, slackApi };
