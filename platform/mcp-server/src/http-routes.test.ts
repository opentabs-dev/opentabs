import { checkBearerAuth, createHandlers, sweepStaleSessions } from './http-routes.js';
import { createState, STATE_SCHEMA_VERSION } from './state.js';
import { version } from './version.js';
import { describe, expect, test } from 'bun:test';
import type { HotHandlers } from './http-routes.js';
import type { McpServerInstance } from './mcp-setup.js';

/** Create a minimal mock McpServerInstance */
const createMockSession = (): McpServerInstance => ({
  setRequestHandler: () => {},
  connect: () => Promise.resolve(),
  sendToolListChanged: () => Promise.resolve(),
});

describe('checkBearerAuth', () => {
  test('returns null when wsSecret is null (auth disabled)', () => {
    const req = new Request('http://localhost/mcp', { method: 'POST' });
    expect(checkBearerAuth(req, null)).toBeNull();
  });

  test('returns null when Bearer token matches wsSecret', () => {
    const secret = 'test-secret-123';
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(checkBearerAuth(req, secret)).toBeNull();
  });

  test('returns 401 when no Authorization header is present', () => {
    const req = new Request('http://localhost/mcp', { method: 'POST' });
    const res = checkBearerAuth(req, 'my-secret');
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 when Authorization header has wrong token', () => {
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const res = checkBearerAuth(req, 'correct-secret');
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 when Authorization header uses non-Bearer scheme', () => {
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    const res = checkBearerAuth(req, 'my-secret');
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 when Authorization header is "Bearer " with empty token', () => {
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' },
    });
    const res = checkBearerAuth(req, 'my-secret');
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('sweepStaleSessions', () => {
  test('sweeps session whose tracked transport ID is no longer in transports map', () => {
    const state = createState();
    const session = createMockSession();
    const transports = new Map<string, unknown>();
    const sessionServers = [session];

    // Track the session with a transport ID that is NOT in transports
    state.sessionTransportIds.set(session, 'transport-1');

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    expect(swept).toBe(1);
    expect(sessionServers).toHaveLength(0);
  });

  test('keeps session whose tracked transport ID IS in transports map', () => {
    const state = createState();
    const session = createMockSession();
    const transports = new Map<string, unknown>([['transport-1', {}]]);
    const sessionServers = [session];

    state.sessionTransportIds.set(session, 'transport-1');

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    expect(swept).toBe(0);
    expect(sessionServers).toHaveLength(1);
    expect(sessionServers[0]).toBe(session);
  });

  test('keeps untracked session when sessionServers count equals transports count', () => {
    const state = createState();
    const session = createMockSession();
    const transports = new Map<string, unknown>([['transport-1', {}]]);
    const sessionServers = [session];

    // No transport ID tracked for this session (predates tracking)

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    expect(swept).toBe(0);
    expect(sessionServers).toHaveLength(1);
  });

  test('keeps untracked sessions even when count exceeds transports', () => {
    const state = createState();
    const session1 = createMockSession();
    const session2 = createMockSession();
    const session3 = createMockSession();
    const transports = new Map<string, unknown>([['transport-1', {}]]);
    const sessionServers = [session1, session2, session3];

    // No transport IDs tracked — sessions may be in-flight (onsessioninitialized
    // hasn't fired yet), so they are preserved to avoid trimming valid sessions.

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    expect(swept).toBe(0);
    expect(sessionServers).toHaveLength(3);
  });

  test('sweeps only tracked-stale sessions, keeps untracked and tracked-live', () => {
    const state = createState();
    const trackedStale = createMockSession();
    const trackedLive = createMockSession();
    const untracked1 = createMockSession();
    const untracked2 = createMockSession();
    const transports = new Map<string, unknown>([['transport-live', {}]]);
    const sessionServers = [untracked1, trackedStale, trackedLive, untracked2];

    state.sessionTransportIds.set(trackedStale, 'transport-gone');
    state.sessionTransportIds.set(trackedLive, 'transport-live');

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    // Only trackedStale is swept (its transport ID is gone from transports).
    // untracked1, trackedLive, and untracked2 are all preserved.
    expect(swept).toBe(1);
    expect(sessionServers).toHaveLength(3);
    expect(sessionServers).toContain(untracked1);
    expect(sessionServers).toContain(trackedLive);
    expect(sessionServers).toContain(untracked2);
  });

  test('returns 0 when no sessions exist', () => {
    const state = createState();
    const transports = new Map<string, unknown>();
    const sessionServers: McpServerInstance[] = [];

    const swept = sweepStaleSessions(state, transports as Map<string, never>, sessionServers);

    expect(swept).toBe(0);
    expect(sessionServers).toHaveLength(0);
  });
});

/** Create a HotHandlers instance with minimal dependencies for route testing */
const createTestHandlers = (
  overrides: {
    getHotState?: () => { reloadCount: number; lastReloadTimestamp: number; lastReloadDurationMs: number } | undefined;
  } = {},
): { handlers: HotHandlers; state: ReturnType<typeof createState>; transports: Map<string, never> } => {
  const state = createState();
  const transports = new Map<string, never>();
  const sessionServers: McpServerInstance[] = [];
  const getHotState = overrides.getHotState ?? (() => undefined);
  const handlers = createHandlers({ state, transports, sessionServers, getHotState });
  return { handlers, state, transports };
};

/** Minimal mock bunServer (only needed for WebSocket upgrade paths, not HTTP) */
const mockBunServer = {
  upgrade: () => false,
  timeout: () => {},
};

/** Shape returned by the /health endpoint */
interface HealthResponse {
  status: string;
  version: string;
  extensionConnected: boolean;
  mcpClients: number;
  plugins: number;
  pluginDetails: { name: string; displayName: string; toolCount: number; tabState: string }[];
  toolCount: number;
  uptime: number;
  reloadCount: number;
  lastReloadTimestamp: number;
  lastReloadDurationMs: number;
  stateSchemaVersion: number;
}

/** Shape returned by the /ws-info endpoint */
interface WsInfoResponse {
  wsUrl: string;
  wsSecret?: string;
}

/** Fetch a route and parse the JSON response with a typed shape */
const fetchJson = async <T>(handlers: HotHandlers, url: string): Promise<T> => {
  const req = new Request(url);
  const res = await handlers.fetch(req, mockBunServer);
  expect(res).toBeInstanceOf(Response);
  return (res as Response).json() as Promise<T>;
};

describe('/health endpoint', () => {
  test('returns JSON with all expected fields', async () => {
    const { handlers } = createTestHandlers({
      getHotState: () => ({ reloadCount: 3, lastReloadTimestamp: 1000, lastReloadDurationMs: 42 }),
    });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.status).toBe('ok');
    expect(body.version).toBe(version);
    expect(body.extensionConnected).toBe(false);
    expect(body.mcpClients).toBe(0);
    expect(body.plugins).toBe(0);
    expect(body.pluginDetails).toEqual([]);
    expect(body.toolCount).toBe(0);
    expect(typeof body.uptime).toBe('number');
    expect(body.reloadCount).toBe(3);
    expect(body.lastReloadTimestamp).toBe(1000);
    expect(body.lastReloadDurationMs).toBe(42);
    expect(body.stateSchemaVersion).toBe(STATE_SCHEMA_VERSION);
  });

  test('reflects registered plugins in pluginDetails', async () => {
    const { handlers, state } = createTestHandlers();

    state.plugins.set('test-plugin', {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      urlPatterns: ['*://example.com/*'],
      trustTier: 'local',
      iife: '(function(){})()',
      tools: [{ name: 'do_thing', description: 'Does a thing', input_schema: {}, output_schema: {} }],
    });
    state.tabMapping.set('test-plugin', { state: 'ready', tabId: 1, url: 'https://example.com' });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.plugins).toBe(1);
    expect(body.pluginDetails).toHaveLength(1);
    expect(body.pluginDetails[0]?.name).toBe('test-plugin');
    expect(body.pluginDetails[0]?.displayName).toBe('Test Plugin');
    expect(body.pluginDetails[0]?.toolCount).toBe(1);
    expect(body.pluginDetails[0]?.tabState).toBe('ready');
  });

  test('uses fallback values when getHotState returns undefined', async () => {
    const { handlers } = createTestHandlers({ getHotState: () => undefined });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.reloadCount).toBe(0);
    expect(body.lastReloadTimestamp).toBe(0);
    expect(body.lastReloadDurationMs).toBe(0);
  });

  test('includes browser tools in toolCount', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_openTab', description: 'Open tab', inputSchema: {}, tool: {} as never },
      { name: 'browser_closeTab', description: 'Close tab', inputSchema: {}, tool: {} as never },
    ];

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.toolCount).toBe(2);
  });
});

describe('/ws-info endpoint', () => {
  test('returns wsUrl without secret when no auth configured', async () => {
    const { handlers } = createTestHandlers();

    const body = await fetchJson<WsInfoResponse>(handlers, 'http://localhost:9876/ws-info');

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
    expect(body).not.toHaveProperty('wsSecret');
  });

  test('returns wsUrl with secret when auth is configured and Bearer token matches', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Authorization: 'Bearer my-test-secret' },
    });
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    const body = (await (res as Response).json()) as WsInfoResponse;

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
    expect(body.wsSecret).toBe('my-test-secret');
  });

  test('allows unauthenticated requests within rate limit when auth is configured', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info');
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
    const body = (await (res as Response).json()) as WsInfoResponse;
    expect(body.wsSecret).toBe('my-test-secret');
  });

  test('returns 429 when unauthenticated requests exceed rate limit', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    // Send enough unauthenticated requests to exhaust the 10 req/min rate limit.
    // Earlier tests in this describe block may have already consumed some slots
    // (endpointCallTimestamps is module-level), so we send extra to guarantee
    // the limit is hit.
    for (let i = 0; i < 12; i++) {
      const req = new Request('http://localhost:9876/ws-info');
      await handlers.fetch(req, mockBunServer);
    }

    // Next request should be rate-limited
    const req = new Request('http://localhost:9876/ws-info');
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(429);
  });

  test('authenticated requests bypass rate limit', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    // Rate limit was already exhausted by the previous test (shared module state).
    // Send additional requests to make sure it's exhausted.
    for (let i = 0; i < 12; i++) {
      const req = new Request('http://localhost:9876/ws-info');
      await handlers.fetch(req, mockBunServer);
    }

    // Authenticated request should still succeed
    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Authorization: 'Bearer my-test-secret' },
    });
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
    const body = (await (res as Response).json()) as WsInfoResponse;
    expect(body.wsSecret).toBe('my-test-secret');
  });
});
