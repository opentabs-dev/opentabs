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

    return {
      token: team.token,
      workspaceUrl: window.location.origin,
      teamId,
    };
  } catch {
    return null;
  }
};

/**
 * Try to read auth from boot_data global (new app.slack.com client).
 * The new Slack client injects `boot_data` on the window with the API token
 * after initial authentication. Also checks `window.TS.boot_data` which is
 * used in some Slack client versions.
 */
const getAuthFromBootData = (): SlackAuth | null => {
  try {
    const g = globalThis as Record<string, unknown>;

    // Try window.boot_data directly
    let bootData = g.boot_data as SlackBootData | undefined;

    // Try window.TS.boot_data (alternate location in some client versions)
    if (!bootData?.api_token) {
      const ts = g.TS as { boot_data?: SlackBootData } | undefined;
      if (ts?.boot_data) {
        bootData = ts.boot_data;
      }
    }

    if (!bootData?.api_token || typeof bootData.api_token !== 'string') return null;

    const teamId = typeof bootData.team_id === 'string' ? bootData.team_id : '';
    const teamUrl = typeof bootData.team_url === 'string' ? bootData.team_url : window.location.origin;

    return {
      token: bootData.api_token,
      workspaceUrl: teamUrl.replace(/\/$/, '') || window.location.origin,
      teamId,
    };
  } catch {
    return null;
  }
};

/**
 * Try to read auth from inline `<script>` tags in the page HTML.
 * The modern app.slack.com client embeds configuration JSON in script tags
 * during server-side rendering. This JSON contains `api_token`, `team_id`,
 * and `team_url` fields needed for API calls.
 */
const getAuthFromPageScripts = (): SlackAuth | null => {
  try {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent;
      if (!text) continue;

      // Match xoxc- tokens (Slack session tokens) in any JSON-like context
      const tokenMatch = /["']api_token["']\s*:\s*["'](xoxc-[a-zA-Z0-9-]+)["']/.exec(text);
      if (!tokenMatch?.[1]) continue;

      const token = tokenMatch[1];

      // Extract team_id from the same script block
      const teamIdMatch = /["']team_id["']\s*:\s*["'](T[A-Z0-9]+)["']/.exec(text);
      const teamId = teamIdMatch?.[1] ?? '';

      // Extract team_url from the same script block
      const teamUrlMatch = /["']team_url["']\s*:\s*["'](https?:\/\/[^"']+)["']/.exec(text);
      const teamUrl = teamUrlMatch?.[1]?.replace(/\/$/, '') ?? '';

      return {
        token,
        workspaceUrl: teamUrl || window.location.origin,
        teamId,
      };
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Scan all localStorage keys for Slack auth tokens.
 * The modern app.slack.com client may store tokens under different key names
 * than the legacy `localConfig_v2`/`v3` keys. This scans all keys and parses
 * any JSON values that contain xoxc- tokens.
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
          return {
            token: tokenMatch[1],
            workspaceUrl: window.location.origin,
            teamId: '',
          };
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
 * (`api_token` or `token` containing an xoxc- value).
 */
const extractAuthFromObject = (obj: unknown): SlackAuth | null => {
  if (typeof obj !== 'object' || obj === null) return null;

  const record = obj as Record<string, unknown>;

  // Check for api_token or token fields directly
  const tokenCandidate = record.api_token ?? record.token;
  if (typeof tokenCandidate === 'string' && tokenCandidate.startsWith('xoxc-')) {
    const teamId = typeof record.team_id === 'string' ? record.team_id : '';
    const teamUrl = typeof record.team_url === 'string' ? record.team_url : '';
    return {
      token: tokenCandidate,
      workspaceUrl: teamUrl.replace(/\/$/, '') || window.location.origin,
      teamId,
    };
  }

  // Recurse one level into object values (avoid deep recursion on large structures)
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const result = extractAuthFromObject(value);
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
    throw new ToolError(error, error);
  }

  return data as T & { ok: true };
};

export { isSlackAuthenticated, slackApi };
