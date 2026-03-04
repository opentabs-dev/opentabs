import { getCookie, ToolError } from '@opentabs-dev/plugin-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FigmaAuth {
  fuid: string;
  teamId: string;
}

// ---------------------------------------------------------------------------
// Token persistence (survives adapter re-injection)
// ---------------------------------------------------------------------------

const getPersistedAuth = (): FigmaAuth | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, FigmaAuth | undefined> | undefined;
    return cache?.figma ?? null;
  } catch {
    return null;
  }
};

const setPersistedAuth = (auth: FigmaAuth): void => {
  try {
    const g = globalThis as Record<string, unknown>;
    if (!g.__openTabs) g.__openTabs = {};
    const ns = g.__openTabs as Record<string, unknown>;
    if (!ns.tokenCache) ns.tokenCache = {};
    const cache = ns.tokenCache as Record<string, FigmaAuth | undefined>;
    cache.figma = auth;
  } catch {}
};

const clearPersistedAuth = (): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, FigmaAuth | undefined> | undefined;
    if (cache) cache.figma = undefined;
  } catch {}
};

// ---------------------------------------------------------------------------
// Auth extraction
// ---------------------------------------------------------------------------

const extractFuidFromCookie = (): string | null => {
  const raw = getCookie('recent_user_data');
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw) as string;
    const data = JSON.parse(outer) as { fileBrowserUserId?: string };
    return data.fileBrowserUserId ?? null;
  } catch {
    return null;
  }
};

const extractTeamIdFromUrl = (): string | null => {
  const match = window.location.pathname.match(/\/files\/team\/(\d+)/);
  return match?.[1] ?? null;
};

const extractFromInitialOptions = (): { fuid?: string; teamId?: string } => {
  const result: { fuid?: string; teamId?: string } = {};
  try {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const text = s.textContent ?? '';
      if (!text.includes('INITIAL_OPTIONS')) continue;

      const fuidMatch = text.match(/"fuid["\s]*[:=]\s*["']?(\d+)/);
      if (fuidMatch) result.fuid = fuidMatch[1];

      const teamMatch = text.match(/"team_id"\s*:\s*"(\d+)"/);
      if (teamMatch) result.teamId = teamMatch[1];

      if (result.fuid && result.teamId) break;
    }
  } catch {}
  return result;
};

const extractTeamIdFromUserState = (): string | null => {
  const raw = getCookie('recent_user_data');
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw) as string;
    const data = JSON.parse(outer) as { userIdToPlan?: Record<string, [string, string]> };
    if (!data.userIdToPlan) return null;
    const plans = Object.values(data.userIdToPlan);
    if (plans.length > 0 && plans[0] && plans[0].length >= 2) return plans[0][1] ?? null;
  } catch {}
  return null;
};

const getAuth = (): FigmaAuth | null => {
  const persisted = getPersistedAuth();
  if (persisted) return persisted;

  // Detect auth status via non-HttpOnly cookie
  const authnState = getCookie('__Host-figma.authn-state');
  if (authnState !== '1') return null;

  // Extract fuid
  let fuid = extractFuidFromCookie();
  if (!fuid) {
    const opts = extractFromInitialOptions();
    fuid = opts.fuid ?? null;
  }
  if (!fuid) {
    const urlMatch = window.location.search.match(/fuid=(\d+)/);
    fuid = urlMatch?.[1] ?? null;
  }
  if (!fuid) return null;

  // Extract team ID
  let teamId = extractTeamIdFromUrl();
  if (!teamId) {
    const opts = extractFromInitialOptions();
    teamId = opts.teamId ?? null;
  }
  if (!teamId) teamId = extractTeamIdFromUserState();
  if (!teamId) teamId = '';

  const auth: FigmaAuth = { fuid, teamId };
  setPersistedAuth(auth);
  return auth;
};

// ---------------------------------------------------------------------------
// Public auth helpers
// ---------------------------------------------------------------------------

export const isFigmaAuthenticated = (): boolean => getAuth() !== null;

export const waitForFigmaAuth = (): Promise<boolean> =>
  new Promise(resolve => {
    let elapsed = 0;
    const interval = 500;
    const maxWait = 5000;
    const timer = setInterval(() => {
      elapsed += interval;
      if (isFigmaAuthenticated()) {
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

// ---------------------------------------------------------------------------
// API caller
// ---------------------------------------------------------------------------

export const figmaApi = async <T extends Record<string, unknown>>(
  endpoint: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Figma.');

  // Build URL with query params (auto-append fuid if not present)
  let url = `https://www.figma.com/api${endpoint}`;
  const params = new URLSearchParams();
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.append(key, String(value));
    }
  }
  if (!params.has('fuid') && auth.fuid) {
    params.append('fuid', auth.fuid);
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  // Set headers
  const headers: Record<string, string> = {};
  let fetchBody: string | undefined;
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  // Make request
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
    if (err instanceof DOMException && err.name === 'AbortError') throw new ToolError('Request was aborted', 'aborted');
    throw new ToolError(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'network_error', {
      category: 'internal',
      retryable: true,
    });
  }

  // Classify HTTP errors
  if (!response.ok) {
    const errorBody = (await response.text().catch(() => '')).substring(0, 512);
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
      throw ToolError.rateLimited(`Rate limited: ${endpoint} — ${errorBody}`, retryMs);
    }
    if (response.status === 401 || response.status === 403) {
      clearPersistedAuth();
      throw ToolError.auth(`Auth error (${response.status}): ${errorBody}`);
    }
    if (response.status === 404) throw ToolError.notFound(`Not found: ${endpoint} — ${errorBody}`);
    throw ToolError.internal(`API error (${response.status}): ${endpoint} — ${errorBody}`);
  }

  if (response.status === 204) return {} as T;

  const data = (await response.json()) as { error?: boolean; status?: number; message?: string; meta?: unknown };

  // Figma API wraps responses in { error, status, meta }
  if (data.error) {
    const msg = data.message ?? 'Unknown Figma API error';
    if (data.status === 401 || data.status === 403) {
      clearPersistedAuth();
      throw ToolError.auth(msg);
    }
    if (data.status === 404) throw ToolError.notFound(msg);
    if (data.status === 429) throw ToolError.rateLimited(msg);
    if (data.status === 400) throw ToolError.validation(msg);
    throw ToolError.internal(msg);
  }

  return data as T;
};

// Helper to get auth context (fuid + teamId)
export const getAuthContext = (): { fuid: string; teamId: string } => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to Figma.');
  return auth;
};
