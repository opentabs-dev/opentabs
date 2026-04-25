import {
  ToolError,
  fetchJSON,
  getLocalStorage,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  waitUntil,
  buildQueryString,
  log,
} from '@opentabs-dev/plugin-sdk';
import type { FetchFromPageOptions } from '@opentabs-dev/plugin-sdk';

// --- Types ---

interface ClickUpAuth {
  token: string;
  apiUrlBase: string;
  workspaceId: string;
}

interface HandshakeEntry {
  appEnvironment: {
    apiUrlBase: string;
    websocketUrl: string;
    [key: string]: unknown;
  };
  shardId: string;
  workspaceId: string;
}

// --- WebSocket JWT Interception ---

/**
 * Installs a WebSocket.prototype.send interceptor that captures the session JWT
 * from ClickUp's WebSocket auth frame ({method: "auth", token: "..."}).
 * This runs at adapter load time, before the Angular SPA bootstraps and creates
 * its WebSocket connection. The captured token is stored on globalThis for retrieval.
 */
const installWsInterceptor = (): void => {
  const g = globalThis as Record<string, unknown>;
  if (g.__cu_ws_interceptor_installed) return;
  g.__cu_ws_interceptor_installed = true;

  const OrigSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data: string | Blob | BufferSource) {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as { method?: string; token?: string; teamId?: string };
        if (parsed.method === 'auth' && parsed.token) {
          g.__cu_captured_jwt = parsed.token;
          if (parsed.teamId) {
            g.__cu_captured_team_id = parsed.teamId;
          }
          log.debug('Captured ClickUp session JWT from WebSocket auth frame');
        }
      } catch {
        // Not JSON — ignore
      }
    }
    return OrigSend.call(this, data);
  };
};

// Install immediately at module load time (adapter IIFE runs before Angular)
installWsInterceptor();

// --- Auth Extraction ---

const getAuth = (): ClickUpAuth | null => {
  // 1. Check persisted cache first (survives adapter re-injection)
  const cached = getAuthCache<ClickUpAuth>('clickup');
  if (cached?.token && cached?.apiUrlBase) return cached;

  // 2. Get the JWT from WebSocket interception
  const g = globalThis as Record<string, unknown>;
  const token = g.__cu_captured_jwt as string | undefined;
  if (!token) return null;

  // 3. Get the workspace config from localStorage (cuHandshake)
  const handshakeRaw = getLocalStorage('cuHandshake');
  if (!handshakeRaw) return null;

  let handshake: Record<string, HandshakeEntry>;
  try {
    handshake = JSON.parse(handshakeRaw) as Record<string, HandshakeEntry>;
  } catch {
    return null;
  }

  // Find the first workspace entry (or use the captured teamId)
  const capturedTeamId = g.__cu_captured_team_id as string | undefined;
  const workspaceId = capturedTeamId ?? Object.keys(handshake)[0];
  if (!workspaceId) return null;

  const entry = handshake[workspaceId];
  if (!entry?.appEnvironment?.apiUrlBase) return null;

  const auth: ClickUpAuth = {
    token,
    apiUrlBase: entry.appEnvironment.apiUrlBase,
    workspaceId,
  };
  setAuthCache('clickup', auth);
  return auth;
};

export const isAuthenticated = (): boolean => getAuth() !== null;

export const waitForAuth = async (): Promise<boolean> => {
  try {
    await waitUntil(() => isAuthenticated(), { interval: 1000, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
};

/** Returns the current workspace ID from auth, or throws. */
export const getWorkspaceId = (): string => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to ClickUp.');
  return auth.workspaceId;
};

// --- API Caller ---

/**
 * Makes an authenticated request to the ClickUp internal v1 API.
 * Uses the session JWT captured from the WebSocket auth frame.
 * The apiUrlBase comes from the cuHandshake localStorage entry.
 */
export const api = async <T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> => {
  const auth = getAuth();
  if (!auth) throw ToolError.auth('Not authenticated — please log in to ClickUp.');

  const qs = options.query ? buildQueryString(options.query) : '';
  const url = qs ? `${auth.apiUrlBase}${endpoint}?${qs}` : `${auth.apiUrlBase}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };

  const init: FetchFromPageOptions = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  try {
    const data = await fetchJSON<T>(url, init);
    return data as T;
  } catch (error) {
    // On 401, clear the cached auth so it re-reads on next call
    if (error instanceof ToolError && error.message.includes('401')) {
      clearAuthCache('clickup');
    }
    throw error;
  }
};
