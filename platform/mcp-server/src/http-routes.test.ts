import type { WsHandle } from '@opentabs-dev/shared';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import type { HotHandlers } from './http-routes.js';
import {
  checkBearerAuth,
  checkEndpointRateLimit,
  createHandlers,
  isLocalhostHost,
  sweepStaleSessions,
} from './http-routes.js';
import type { McpServerInstance } from './mcp-setup.js';
import { buildRegistry } from './registry.js';
import type { CachedBrowserTool, ExtensionConnection, PendingDispatch } from './state.js';
import { createState, getAnyConnection, getMergedTabMapping, STATE_SCHEMA_VERSION } from './state.js';
import { version } from './version.js';

// Suppress console output to prevent Vitest's onUserConsoleLog RPC from racing
// with worker teardown. The wsOpen handler fires `sendSyncFull` as a
// fire-and-forget promise that logs via console.warn after the test completes.
// On macOS, the pending RPC message causes EnvironmentTeardownError.
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** Create a minimal mock McpServerInstance */
const createMockSession = (): McpServerInstance => ({
  setRequestHandler: () => {},
  connect: () => Promise.resolve(),
  sendToolListChanged: () => Promise.resolve(),
  sendLoggingMessage: () => Promise.resolve(),
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

describe('isLocalhostHost', () => {
  test('allows "localhost"', () => {
    expect(isLocalhostHost('localhost')).toBe(true);
  });

  test('allows "localhost:9515"', () => {
    expect(isLocalhostHost('localhost:9515')).toBe(true);
  });

  test('allows "127.0.0.1"', () => {
    expect(isLocalhostHost('127.0.0.1')).toBe(true);
  });

  test('allows "127.0.0.1:9515"', () => {
    expect(isLocalhostHost('127.0.0.1:9515')).toBe(true);
  });

  test('allows "[::1]"', () => {
    expect(isLocalhostHost('[::1]')).toBe(true);
  });

  test('allows "[::1]:9515"', () => {
    expect(isLocalhostHost('[::1]:9515')).toBe(true);
  });

  test('allows "[::ffff:127.0.0.1]" (IPv4-mapped IPv6)', () => {
    expect(isLocalhostHost('[::ffff:127.0.0.1]')).toBe(true);
  });

  test('allows "[::ffff:127.0.0.1]:9515" (IPv4-mapped IPv6 with port)', () => {
    expect(isLocalhostHost('[::ffff:127.0.0.1]:9515')).toBe(true);
  });

  test('rejects "evil.com"', () => {
    expect(isLocalhostHost('evil.com')).toBe(false);
  });

  test('rejects "evil.com:9515"', () => {
    expect(isLocalhostHost('evil.com:9515')).toBe(false);
  });

  test('rejects "localhost.evil.com"', () => {
    expect(isLocalhostHost('localhost.evil.com')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isLocalhostHost('')).toBe(false);
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
  const gatewayTransports = new Map<string, never>();
  const gatewaySessionServers: McpServerInstance[] = [];
  const getHotState = overrides.getHotState ?? (() => undefined);
  const handlers = createHandlers({
    state,
    transports,
    sessionServers,
    gatewayTransports,
    gatewaySessionServers,
    getHotState,
  });
  return { handlers, state, transports };
};

/** Minimal mock server adapter (only needed for WebSocket upgrade paths, not HTTP) */
const mockServer = {
  upgrade: () => false,
  timeout: () => {},
};

/** Shape returned by the /health endpoint */
interface HealthResponse {
  status: string;
  version: string;
  mode: 'dev' | 'production';
  extensionConnected: boolean;
  extensionConnections: number;
  mcpClients: number;
  plugins: number;
  pluginDetails: { name: string; displayName: string; toolCount: number; tabState: string; source: string }[];
  toolCount: number;
  browserToolCount: number;
  pluginToolCount: number;
  browserToolNames: string[];
  disabledBrowserTools: string[];
  skipPermissions: boolean;
  uptime: number;
  reloadCount: number;
  lastReloadTimestamp: number;
  lastReloadDurationMs: number;
  stateSchemaVersion: number;
}

/** Shape returned by the /ws-info endpoint */
interface WsInfoResponse {
  wsUrl: string;
}

/** Fetch a route and parse the JSON response with a typed shape */
const fetchJson = async <T>(handlers: HotHandlers, url: string, headers?: Record<string, string>): Promise<T> => {
  const req = new Request(url, { headers: { Host: new URL(url).host, ...headers } });
  const res = await handlers.fetch(req, mockServer);
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
    expect(body.extensionConnections).toBe(0);
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

    state.registry = buildRegistry(
      [
        {
          name: 'test-plugin',
          version: '1.0.0',
          displayName: 'Test Plugin',
          urlPatterns: ['*://example.com/*'],
          excludePatterns: [],
          source: 'local' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'do_thing',
              displayName: 'Do Thing',
              description: 'Does a thing',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    const conn: ExtensionConnection = {
      ws: { send() {}, close() {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    conn.tabMapping.set('test-plugin', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Example', ready: true }],
    });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.plugins).toBe(1);
    expect(body.pluginDetails).toHaveLength(1);
    expect(body.pluginDetails[0]?.name).toBe('test-plugin');
    expect(body.pluginDetails[0]?.displayName).toBe('Test Plugin');
    expect(body.pluginDetails[0]?.toolCount).toBe(1);
    expect(body.pluginDetails[0]?.tabState).toBe('ready');
    expect(body.pluginDetails[0]?.source).toBe('local');
  });

  test('uses fallback values when getHotState returns undefined', async () => {
    const { handlers } = createTestHandlers({ getHotState: () => undefined });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.reloadCount).toBe(0);
    expect(body.lastReloadTimestamp).toBe(0);
    expect(body.lastReloadDurationMs).toBe(0);
  });

  test('includes mode field (production when tests run without --dev)', async () => {
    const { handlers } = createTestHandlers();

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.mode).toBe('production');
  });

  test('does not leak wsSecret in the response body', async () => {
    const { handlers, state } = createTestHandlers();
    const secret = 'super-secret-token-12345';
    state.wsSecret = secret;

    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);
    expect(res).toBeInstanceOf(Response);
    const text = await (res as Response).text();

    expect(text).not.toContain(secret);
  });

  test('includes browser tools in toolCount and browserToolCount', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_openTab', description: 'Open tab', inputSchema: {}, tool: {} as never },
      { name: 'browser_closeTab', description: 'Close tab', inputSchema: {}, tool: {} as never },
    ];

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.toolCount).toBe(2);
    expect(body.browserToolCount).toBe(2);
    expect(body.pluginToolCount).toBe(0);
  });

  test('disabledBrowserTools is empty when no tools are disabled', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: {} as never },
    ];
    // Browser tools default to 'off' when no permission config exists, so
    // explicitly enable the browser plugin to test the "no tools disabled" case.
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.disabledBrowserTools).toEqual([]);
  });

  test('disabledBrowserTools lists tools disabled via pluginPermissions', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: {} as never },
      { name: 'browser_execute_script', description: 'Execute script', inputSchema: {}, tool: {} as never },
      { name: 'browser_get_cookies', description: 'Get cookies', inputSchema: {}, tool: {} as never },
    ];
    state.pluginPermissions = {
      browser: { permission: 'auto', tools: { browser_execute_script: 'off', browser_get_cookies: 'off' } },
    };

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.disabledBrowserTools).toEqual(['browser_execute_script', 'browser_get_cookies']);
  });

  test('browserToolNames lists all browser tool names regardless of policy', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: {} as never },
      { name: 'browser_execute_script', description: 'Execute script', inputSchema: {}, tool: {} as never },
      { name: 'browser_get_cookies', description: 'Get cookies', inputSchema: {}, tool: {} as never },
    ];
    state.pluginPermissions = { browser: { tools: { browser_execute_script: 'off' } } };

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.browserToolNames).toEqual(['browser_list_tabs', 'browser_execute_script', 'browser_get_cookies']);
  });

  test('unauthenticated request returns minimal response when secret is set', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const body = await fetchJson<Record<string, unknown>>(handlers, 'http://localhost:9876/health');

    expect(body.status).toBe('ok');
    // Unauthenticated response omits version and extensionConnected to prevent fingerprinting
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('extensionConnected');
    expect(body).not.toHaveProperty('extensionConnections');
    expect(body).not.toHaveProperty('pluginDetails');
    expect(body).not.toHaveProperty('toolCount');
    expect(body).not.toHaveProperty('uptime');
    expect(body).not.toHaveProperty('plugins');
    expect(body).not.toHaveProperty('failedPlugins');
    expect(body).not.toHaveProperty('discoveryErrors');
    expect(body).not.toHaveProperty('auditSummary');
    expect(body).not.toHaveProperty('fileWatcher');
    expect(body).not.toHaveProperty('mcpClients');
    expect(body).not.toHaveProperty('mode');
  });

  test('authenticated request returns full response when secret is set', async () => {
    const secret = 'test-secret';
    const { handlers, state } = createTestHandlers({
      getHotState: () => ({ reloadCount: 5, lastReloadTimestamp: 2000, lastReloadDurationMs: 10 }),
    });
    state.wsSecret = secret;

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health', {
      Authorization: `Bearer ${secret}`,
    });

    expect(body.status).toBe('ok');
    expect(body.version).toBe(version);
    expect(body.extensionConnected).toBe(false);
    expect(body.extensionConnections).toBe(0);
    expect(body.mcpClients).toBe(0);
    expect(body.plugins).toBe(0);
    expect(body.pluginDetails).toEqual([]);
    expect(typeof body.uptime).toBe('number');
    expect(body.reloadCount).toBe(5);
    expect(body.toolCount).toBe(0);
    expect(body.stateSchemaVersion).toBe(STATE_SCHEMA_VERSION);
  });

  test('unauthenticated request still returns 200 (not 401) for monitoring', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('unauthenticated response includes x-opentabs-version header', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get('x-opentabs-version')).toBe(version);
  });

  test('authenticated response includes x-opentabs-version header', async () => {
    const secret = 'test-secret';
    const { handlers, state } = createTestHandlers();
    state.wsSecret = secret;

    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Authorization: `Bearer ${secret}` },
    });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get('x-opentabs-version')).toBe(version);
  });

  test('response includes x-opentabs-version header when no secret configured', async () => {
    const { handlers } = createTestHandlers();

    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get('x-opentabs-version')).toBe(version);
  });
});

describe('/ws-info endpoint', () => {
  test('returns wsUrl when no auth configured', async () => {
    const { handlers } = createTestHandlers();

    const body = await fetchJson<WsInfoResponse>(handlers, 'http://localhost:9876/ws-info');

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
  });

  test('returns wsUrl only (no wsSecret) when auth is configured and Bearer token matches', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Host: 'localhost:9876', Authorization: 'Bearer my-test-secret' },
    });
    const res = await handlers.fetch(req, mockServer);
    expect(res).toBeInstanceOf(Response);
    const body = (await (res as Response).json()) as Record<string, unknown>;

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
    expect(body).not.toHaveProperty('wsSecret');
  });

  test('returns 401 for unauthenticated requests when auth is configured', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 for requests with wrong Bearer token', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Host: 'localhost:9876', Authorization: 'Bearer wrong-token' },
    });
    const res = await handlers.fetch(req, mockServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('POST /reload endpoint', () => {
  test('returns 401 without bearer auth', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/reload', { method: 'POST', headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('POST /plugin-settings endpoint', () => {
  test('returns 401 without bearer auth', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/plugin-settings', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: 'test', settings: { key: 'val' } }),
    });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 400 when plugin field is missing', async () => {
    const { handlers } = createTestHandlers();

    const req = new Request('http://localhost:9876/plugin-settings', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { key: 'val' } }),
    });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    const body = (await (res as Response).json()) as { error: string };
    expect(body.error).toContain('plugin');
  });

  test('returns 400 when settings field is missing', async () => {
    const { handlers } = createTestHandlers();

    const req = new Request('http://localhost:9876/plugin-settings', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin: 'test' }),
    });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    const body = (await (res as Response).json()) as { error: string };
    expect(body.error).toContain('settings');
  });
});

/** Create a simple mock WsHandle for WebSocket lifecycle tests */
const createMockWsHandle = (): WsHandle & { sent: string[]; closed: boolean } => ({
  sent: [] as string[],
  closed: false,
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {
    this.closed = true;
  },
});

describe('wsClose handler', () => {
  test('matching ws removes the connection from extensionConnections', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handlers.wsClose(ws);

    expect(state.extensionConnections.size).toBe(0);
  });

  test('matching ws rejects all pending dispatches with "Extension disconnected"', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const errors: Error[] = [];
    const pending1: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        errors.push(err);
      },
      label: 'test1',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    const pending2: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        errors.push(err);
      },
      label: 'test2',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set('id-1', pending1);
    state.pendingDispatches.set('id-2', pending2);

    handlers.wsClose(ws);

    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toBe('Extension disconnected');
    expect(errors[1]?.message).toBe('Extension disconnected');
    expect(state.pendingDispatches.size).toBe(0);
  });

  test('matching ws clears timeout timers for all pending dispatches', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let timerFired = false;
    const timerId = setTimeout(() => {
      timerFired = true;
    }, 100);
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test',
      startTs: Date.now(),
      timerId,
    };
    state.pendingDispatches.set('id-1', pending);

    handlers.wsClose(ws);

    // Give the timer a chance to fire if clearTimeout wasn't called
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(timerFired).toBe(false);
        resolve();
      }, 200);
    });
  });

  test('non-matching ws (stale close) does not modify state', () => {
    const { handlers, state } = createTestHandlers();
    const currentWs = createMockWsHandle();
    const staleWs = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: currentWs,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const errors: Error[] = [];
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        errors.push(err);
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set('id-1', pending);

    handlers.wsClose(staleWs);

    // State should be unchanged — stale close is ignored
    expect(state.extensionConnections.size).toBe(1);
    expect(getAnyConnection(state)?.ws).toBe(currentWs);
    expect(state.pendingDispatches.size).toBe(1);
    expect(errors).toHaveLength(0);

    // Cleanup timer to avoid leaks
    clearTimeout(pending.timerId);
  });

  test('matching ws with no pending dispatches is a no-op (no throw)', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    expect(() => handlers.wsClose(ws)).not.toThrow();
    expect(state.extensionConnections.size).toBe(0);
    expect(state.pendingDispatches.size).toBe(0);
  });

  test('matching ws clears activeNetworkCaptures and tabMapping', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    const conn: ExtensionConnection = {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);

    conn.activeNetworkCaptures.add(1);
    conn.activeNetworkCaptures.add(2);
    conn.tabMapping.set('plugin-a', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Example', ready: true }],
    });
    conn.tabMapping.set('plugin-b', { state: 'unavailable', tabs: [] });

    handlers.wsClose(ws);

    // Connection removed — no more connections
    expect(state.extensionConnections.size).toBe(0);
    expect(getMergedTabMapping(state).size).toBe(0);
  });
});

describe('wsOpen handler', () => {
  test('adds new connection to extensionConnections', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();

    handlers.wsOpen(ws);

    expect(state.extensionConnections.size).toBe(1);
    expect(getAnyConnection(state)?.ws).toBe(ws);
  });

  test('closes previous ws when replaced by a new connection', () => {
    const { handlers, state } = createTestHandlers();
    const oldWs = createMockWsHandle();
    const newWs = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: oldWs,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handlers.wsOpen(newWs);

    expect(state.extensionConnections.size).toBe(1);
    expect(getAnyConnection(state)?.ws).toBe(newWs);
    expect(oldWs.closed).toBe(true);
  });

  test('old ws is closed when replaced by new connection', () => {
    const { handlers, state } = createTestHandlers();
    let closeCalled = false;
    const oldWs: WsHandle = {
      send() {},
      close() {
        closeCalled = true;
      },
    };
    const newWs = createMockWsHandle();
    state.extensionConnections.set('test-conn', {
      ws: oldWs,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handlers.wsOpen(newWs);

    expect(closeCalled).toBe(true);
    expect(state.extensionConnections.size).toBe(1);
    expect(getAnyConnection(state)?.ws).toBe(newWs);
  });

  test('no previous connection works without error', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    // extensionConnections is empty by default

    expect(() => handlers.wsOpen(ws)).not.toThrow();
    expect(state.extensionConnections.size).toBe(1);
    expect(getAnyConnection(state)?.ws).toBe(ws);
  });
});

describe('CORS protection', () => {
  test('request with Origin: http://evil.com returns 403 Forbidden', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'http://evil.com' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('request with Origin: https://attacker.io returns 403 Forbidden', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'https://attacker.io' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('request with Origin: chrome-extension://abc123 passes through (200)', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'chrome-extension://abc123' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with no Origin header passes through (200)', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });
});

describe('Host header validation (DNS rebinding protection)', () => {
  test('request with Host: evil.com returns 403', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'evil.com' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe('Forbidden: invalid Host header');
  });

  test('request with Host: localhost passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: localhost:9515 passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9515' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: 127.0.0.1 passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: '127.0.0.1' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: [::1] passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: '[::1]' },
    });

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with missing Host header returns 403', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health');

    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe('Forbidden: invalid Host header');
  });
});

describe('WebSocket upgrade origin check', () => {
  /** Mock server that reports successful upgrades */
  const upgradingServer = {
    upgrade: () => true,
    timeout: () => {},
  };

  test('WS upgrade rejected with Origin: http://evil.com (403)', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/ws', {
      headers: {
        Host: 'localhost:9876',
        Origin: 'http://evil.com',
        Upgrade: 'websocket',
      },
    });

    const res = await handlers.fetch(req, upgradingServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('WS upgrade allowed with no Origin header (proceeds to secret check)', async () => {
    const { handlers } = createTestHandlers();
    // No wsSecret configured, so no auth is needed — upgrade should succeed
    const req = new Request('http://localhost:9876/ws', {
      headers: { Host: 'localhost:9876', Upgrade: 'websocket' },
    });

    const res = await handlers.fetch(req, upgradingServer);

    // Successful upgrade returns undefined
    expect(res).toBeUndefined();
  });

  test('WS upgrade allowed with Origin: chrome-extension://abc (proceeds to secret check)', async () => {
    const { handlers } = createTestHandlers();
    // No wsSecret configured, so no auth is needed — upgrade should succeed
    const req = new Request('http://localhost:9876/ws', {
      headers: {
        Host: 'localhost:9876',
        Origin: 'chrome-extension://abc',
        Upgrade: 'websocket',
      },
    });

    const res = await handlers.fetch(req, upgradingServer);

    // Successful upgrade returns undefined
    expect(res).toBeUndefined();
  });
});

describe('/mcp session creation rate limiting', () => {
  test('returns 429 after 5 new session attempts per minute', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = null; // Disable auth for simpler test

    // Send 5 POST requests without session ID — each passes rate limit and gets 400 (not initialize)
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost:9876/mcp', {
        method: 'POST',
        headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
        body: JSON.stringify({ not: 'an initialize request' }),
      });
      const res = (await handlers.fetch(req, mockServer)) as Response;
      expect(res.status).toBe(400);
    }

    // 6th request should be rate-limited
    const req = new Request('http://localhost:9876/mcp', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'an initialize request' }),
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  test('unknown session IDs fall through to rate-limited new session path', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = null;

    // Exhaust the rate limit with new session attempts
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost:9876/mcp', {
        method: 'POST',
        headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
        body: JSON.stringify({ not: 'an initialize request' }),
      });
      await handlers.fetch(req, mockServer);
    }

    // A request with an unknown session ID falls through to the new session path
    // and is subject to the same rate limit
    const req = new Request('http://localhost:9876/mcp', {
      method: 'POST',
      headers: {
        Host: 'localhost:9876',
        'Content-Type': 'application/json',
        'mcp-session-id': 'non-existent-session',
      },
      body: JSON.stringify({ method: 'tools/list' }),
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;
    expect(res.status).toBe(429);
  });

  test('does not rate-limit GET requests to /mcp', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = null;

    // Exhaust the rate limit with new session attempts
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost:9876/mcp', {
        method: 'POST',
        headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
        body: JSON.stringify({ not: 'an initialize request' }),
      });
      await handlers.fetch(req, mockServer);
    }

    // GET requests should not be rate-limited
    const req = new Request('http://localhost:9876/mcp', {
      method: 'GET',
      headers: { Host: 'localhost:9876' },
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;
    // GET without session ID returns 400, not 429
    expect(res.status).toBe(400);
  });
});

describe('checkEndpointRateLimit', () => {
  test('prunes stale map entry when all timestamps have expired', () => {
    const state = createState();
    const staleTime = Date.now() - 70_000; // 70 seconds ago, outside the 60s window
    state.endpointCallTimestamps.set('/reload', [staleTime]);

    checkEndpointRateLimit(state, '/reload', 10);

    // The stale timestamp must have been pruned; only the new call's timestamp should remain.
    // Use nullish coalescing to avoid non-null assertions while keeping the test assertion clear.
    const stored = state.endpointCallTimestamps.get('/reload') ?? [];
    expect(stored.length).toBe(1);
    expect(stored[0]).toBeGreaterThan(staleTime + 60_000);
  });

  test('does not store an empty array when all timestamps have expired and rate limit is hit via maxPerMinute=0', () => {
    const state = createState();
    const staleTime = Date.now() - 70_000;
    state.endpointCallTimestamps.set('/reload', [staleTime]);

    // maxPerMinute=0 means every call is rate-limited; with all timestamps expired
    // the filtered array is empty, so the key should be deleted rather than stored as []
    const allowed = checkEndpointRateLimit(state, '/reload', 0);

    expect(allowed).toBe(false);
    expect(state.endpointCallTimestamps.has('/reload')).toBe(false);
  });
});

describe('multi-connection — wsClose scoping', () => {
  test('closing one connection does not affect the other connection', () => {
    const { handlers, state } = createTestHandlers();
    const wsA = createMockWsHandle();
    const wsB = createMockWsHandle();
    state.extensionConnections.set('conn-a', {
      ws: wsA,
      connectionId: 'conn-a',
      profileLabel: 'conn-a',
      tabMapping: new Map([
        [
          'slack',
          { state: 'ready' as const, tabs: [{ tabId: 1, url: 'https://app.slack.com', title: 'Slack', ready: true }] },
        ],
      ]),
      activeNetworkCaptures: new Set(),
    });
    state.extensionConnections.set('conn-b', {
      ws: wsB,
      connectionId: 'conn-b',
      profileLabel: 'conn-b',
      tabMapping: new Map([
        [
          'discord',
          { state: 'ready' as const, tabs: [{ tabId: 2, url: 'https://discord.com', title: 'Discord', ready: true }] },
        ],
      ]),
      activeNetworkCaptures: new Set(),
    });

    // Close connection A
    handlers.wsClose(wsA);

    // Connection A is removed
    expect(state.extensionConnections.has('conn-a')).toBe(false);
    // Connection B is still present
    expect(state.extensionConnections.has('conn-b')).toBe(true);
    expect(state.extensionConnections.get('conn-b')?.ws).toBe(wsB);
    // Merged tabs only show conn-b's tabs
    expect(getMergedTabMapping(state).size).toBe(1);
    expect(getMergedTabMapping(state).has('discord')).toBe(true);
  });

  test('closing connection A only rejects dispatches sent over connection A', () => {
    const { handlers, state } = createTestHandlers();
    const wsA = createMockWsHandle();
    const wsB = createMockWsHandle();
    state.extensionConnections.set('conn-a', {
      ws: wsA,
      connectionId: 'conn-a',
      profileLabel: 'conn-a',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.extensionConnections.set('conn-b', {
      ws: wsB,
      connectionId: 'conn-b',
      profileLabel: 'conn-b',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const errorsA: Error[] = [];
    const errorsB: Error[] = [];
    const pendingA: PendingDispatch = {
      resolve: () => {},
      reject: err => errorsA.push(err),
      label: 'test-a',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
      connectionId: 'conn-a',
    };
    const pendingB: PendingDispatch = {
      resolve: () => {},
      reject: err => errorsB.push(err),
      label: 'test-b',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
      connectionId: 'conn-b',
    };
    state.pendingDispatches.set('dispatch-a', pendingA);
    state.pendingDispatches.set('dispatch-b', pendingB);

    handlers.wsClose(wsA);

    // Dispatch A is rejected (it was on conn-a)
    expect(errorsA).toHaveLength(1);
    expect(errorsA[0]?.message).toBe('Extension disconnected');
    expect(state.pendingDispatches.has('dispatch-a')).toBe(false);

    // Dispatch B is NOT rejected (it was on conn-b which is still alive)
    expect(errorsB).toHaveLength(0);
    expect(state.pendingDispatches.has('dispatch-b')).toBe(true);

    // Cleanup
    clearTimeout(pendingB.timerId);
  });

  test('health endpoint shows extensionConnected: true with one connection', async () => {
    const { handlers, state } = createTestHandlers();
    state.extensionConnections.set('conn-1', {
      ws: createMockWsHandle(),
      connectionId: 'conn-1',
      profileLabel: 'conn-1',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.extensionConnected).toBe(true);
    expect(body.extensionConnections).toBe(1);
  });

  test('health endpoint shows multiple extensionConnections', async () => {
    const { handlers, state } = createTestHandlers();
    state.extensionConnections.set('conn-1', {
      ws: createMockWsHandle(),
      connectionId: 'conn-1',
      profileLabel: 'conn-1',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.extensionConnections.set('conn-2', {
      ws: createMockWsHandle(),
      connectionId: 'conn-2',
      profileLabel: 'conn-2',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.extensionConnected).toBe(true);
    expect(body.extensionConnections).toBe(2);
  });
});

/** Shape returned by the GET /tools endpoint */
interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  plugin: string;
}

describe('GET /tools endpoint', () => {
  test('returns 401 without bearer auth when secret is set', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/tools', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 200 with empty array when no plugins or browser tools', async () => {
    const { handlers } = createTestHandlers();

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools');

    // Only platform tools should be present
    expect(tools.some(t => t.plugin === 'platform')).toBe(true);
    expect(tools.filter(t => t.plugin === 'browser').length).toBe(0);
  });

  test('returns all tools annotated with plugin names', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a message',
              icon: 'chat',
              input_schema: { type: 'object', properties: {} },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools');

    const slackTool = tools.find(t => t.name === 'slack_send_message');
    expect(slackTool).toBeDefined();
    expect(slackTool?.plugin).toBe('slack');

    const browserTool = tools.find(t => t.name === 'browser_list_tabs');
    expect(browserTool).toBeDefined();
    expect(browserTool?.plugin).toBe('browser');

    const platformTool = tools.find(t => t.name === 'plugin_inspect');
    expect(platformTool).toBeDefined();
    expect(platformTool?.plugin).toBe('platform');
  });

  test('filters by plugin name with ?plugin= query param', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a message',
              icon: 'chat',
              input_schema: { type: 'object', properties: {} },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools?plugin=slack');

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('slack_send_message');
    expect(tools[0]?.plugin).toBe('slack');
  });

  test('filters to browser tools with ?plugin=browser', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a message',
              icon: 'chat',
              input_schema: { type: 'object', properties: {} },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
      { name: 'browser_screenshot', description: 'Screenshot', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools?plugin=browser');

    expect(tools).toHaveLength(2);
    expect(tools.every(t => t.plugin === 'browser')).toBe(true);
  });

  test('returns empty array for nonexistent plugin filter', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools?plugin=nonexistent');

    expect(tools).toEqual([]);
  });

  test('returns tools with auth when secret is configured', async () => {
    const secret = 'test-secret';
    const { handlers, state } = createTestHandlers();
    state.wsSecret = secret;

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools', {
      Authorization: `Bearer ${secret}`,
    });

    expect(tools.some(t => t.name === 'browser_list_tabs')).toBe(true);
  });

  test('each tool entry has name, description, inputSchema, and plugin fields', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a Slack message',
              icon: 'chat',
              input_schema: { type: 'object', properties: { text: { type: 'string' } } },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools');

    const slackTool = tools.find(t => t.name === 'slack_send_message');
    expect(slackTool).toBeDefined();
    expect(slackTool?.name).toBe('slack_send_message');
    // Description includes the original text (may have a [Disabled] prefix when permission is 'off')
    expect(slackTool?.description).toContain('Send a Slack message');
    expect(slackTool?.inputSchema).toBeDefined();
    expect(typeof slackTool?.inputSchema).toBe('object');
    expect(slackTool?.plugin).toBe('slack');
  });

  test('annotates tools from multiple plugins correctly', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send',
              description: 'Send',
              icon: 'chat',
              input_schema: {},
              output_schema: {},
            },
          ],
        },
        {
          name: 'discord',
          version: '2.0.0',
          displayName: 'Discord',
          urlPatterns: ['*://discord.com/*'],
          excludePatterns: [],
          source: 'local' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'read_messages',
              displayName: 'Read',
              description: 'Read',
              icon: 'book',
              input_schema: {},
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools');

    expect(tools.find(t => t.name === 'slack_send_message')?.plugin).toBe('slack');
    expect(tools.find(t => t.name === 'discord_read_messages')?.plugin).toBe('discord');
    expect(tools.find(t => t.name === 'browser_list_tabs')?.plugin).toBe('browser');
    expect(tools.find(t => t.name === 'plugin_inspect')?.plugin).toBe('platform');
  });

  test('filters to platform tools with ?plugin=platform', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send',
              description: 'Send',
              icon: 'chat',
              input_schema: {},
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: { type: 'object' }, tool: {} as never },
    ];

    const tools = await fetchJson<ToolEntry[]>(handlers, 'http://localhost:9876/tools?plugin=platform');

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every(t => t.plugin === 'platform')).toBe(true);
    expect(tools.some(t => t.name === 'plugin_inspect')).toBe(true);
  });
});

/** Shape returned by the POST /tools/:name/call endpoint */
interface ToolCallResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** POST a JSON body to a route and parse the response */
const postJson = async <T>(
  handlers: HotHandlers,
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: T }> => {
  const req = new Request(url, {
    method: 'POST',
    headers: { Host: new URL(url).host, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const res = (await handlers.fetch(req, mockServer)) as Response;
  return { status: res.status, body: (await res.json()) as T };
};

describe('POST /tools/:name/call endpoint', () => {
  test('returns 401 without bearer auth when secret is set', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/tools/some_tool/call', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;

    expect(res.status).toBe(401);
  });

  test('returns 404 for unknown tool', async () => {
    const { handlers } = createTestHandlers();

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/nonexistent_tool/call',
      { arguments: {} },
    );

    expect(status).toBe(404);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('nonexistent_tool');
  });

  test('returns 400 for malformed tool call URL (empty tool name)', async () => {
    const { handlers } = createTestHandlers();

    const req = new Request('http://localhost:9876/tools//call', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;

    expect(res.status).toBe(400);
  });

  test('uses empty args when body has no arguments field', async () => {
    const { handlers } = createTestHandlers();

    // plugin_inspect is a platform tool — calling it with empty args returns an error
    // about missing "plugin" field, confirming the handler was reached with empty args
    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/plugin_inspect/call',
      {},
    );

    expect(status).toBe(200);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('plugin');
  });

  test('dispatches platform tool plugin_inspect', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [],
        },
      ],
      [],
    );

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/plugin_inspect/call',
      { arguments: { plugin: 'slack' } },
    );

    expect(status).toBe(200);
    expect(body.isError).toBeUndefined();
    const parsed = JSON.parse(body.content[0]?.text ?? '{}');
    expect(parsed.plugin).toBe('slack');
  });

  test('dispatches plugin tool and returns error when extension is not connected', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a message',
              icon: 'chat',
              input_schema: { type: 'object', properties: { text: { type: 'string' } } },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    // Set permission to 'auto' so the tool is callable
    state.pluginPermissions.slack = { permission: 'auto', reviewedVersion: '1.0.0' };

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/slack_send_message/call',
      { arguments: { text: 'hello' } },
    );

    // Should return error because extension is not connected
    expect(status).toBe(422);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('Extension not connected');
  });

  test('returns 429 when rate limit is exceeded', async () => {
    const { handlers, state } = createTestHandlers();

    // Exhaust the rate limit (30 calls per minute)
    for (let i = 0; i < 30; i++) {
      state.endpointCallTimestamps.set('/tools/call', [
        ...(state.endpointCallTimestamps.get('/tools/call') ?? []),
        Date.now(),
      ]);
    }

    const req = new Request('http://localhost:9876/tools/some_tool/call', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
    });
    const res = (await handlers.fetch(req, mockServer)) as Response;

    expect(res.status).toBe(429);
  });

  test('works with auth when secret is configured', async () => {
    const secret = 'test-secret';
    const { handlers, state } = createTestHandlers();
    state.wsSecret = secret;

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/plugin_inspect/call',
      { arguments: { plugin: 'nonexistent' } },
      { Authorization: `Bearer ${secret}` },
    );

    // plugin_inspect returns error for nonexistent plugin, confirming auth passed
    expect(status).toBe(200);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('not found');
  });

  test('dispatches browser tool and returns result', async () => {
    const { handlers, state } = createTestHandlers();

    const mockBrowserTool: CachedBrowserTool = {
      name: 'browser_test_tool',
      description: 'A test browser tool',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      tool: {
        name: 'browser_test_tool',
        description: 'A test browser tool',
        input: z.object({ query: z.string().optional() }),
        handler: async () => ({ result: 'success', items: [1, 2, 3] }),
      },
    };
    state.cachedBrowserTools = [mockBrowserTool];
    // Enable the browser plugin so tools are callable
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/browser_test_tool/call',
      { arguments: { query: 'test' } },
    );

    expect(status).toBe(200);
    expect(body.isError).toBeUndefined();
    expect(body.content).toHaveLength(1);
    expect(body.content[0]?.type).toBe('text');
    const parsed = JSON.parse(body.content[0]?.text ?? '{}');
    expect(parsed.result).toBe('success');
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  test('browser tool with disabled permission returns isError', async () => {
    const { handlers, state } = createTestHandlers();

    const mockBrowserTool: CachedBrowserTool = {
      name: 'browser_disabled_tool',
      description: 'A disabled browser tool',
      inputSchema: { type: 'object' },
      tool: {
        name: 'browser_disabled_tool',
        description: 'A disabled browser tool',
        input: z.object({}),
        handler: async () => ({}),
      },
    };
    state.cachedBrowserTools = [mockBrowserTool];
    // Explicitly disable this specific tool
    state.pluginPermissions = { browser: { permission: 'auto', tools: { browser_disabled_tool: 'off' } } };

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/browser_disabled_tool/call',
      { arguments: {} },
    );

    expect(status).toBe(422);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('disabled');
  });

  test('plugin tool with off permission returns error via checkToolCallable', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [
            {
              name: 'send_message',
              displayName: 'Send Message',
              description: 'Send a message',
              icon: 'chat',
              input_schema: { type: 'object', properties: {} },
              output_schema: {},
            },
          ],
        },
      ],
      [],
    );
    // Default permission is 'off' — do not set pluginPermissions to auto

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/slack_send_message/call',
      { arguments: {} },
    );

    // checkToolCallable returns an error for tools on plugins with 'off' permission
    // The tool exists in the registry, but permission checks happen at dispatch time,
    // so it reaches handlePluginToolCall which checks permission
    expect(status).toBe(422);
    expect(body.isError).toBe(true);
  });

  test('response content array matches MCP tools/call shape', async () => {
    const { handlers, state } = createTestHandlers();

    state.registry = buildRegistry(
      [
        {
          name: 'slack',
          version: '1.0.0',
          displayName: 'Slack',
          urlPatterns: ['*://app.slack.com/*'],
          excludePatterns: [],
          source: 'npm' as const,
          iife: '(function(){})()',
          tools: [],
        },
      ],
      [],
    );

    // plugin_inspect returns structured JSON with plugin metadata
    const { body } = await postJson<ToolCallResponse>(handlers, 'http://localhost:9876/tools/plugin_inspect/call', {
      arguments: { plugin: 'slack' },
    });

    // Verify MCP-compatible response shape: content is an array of {type, text} objects
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content.length).toBeGreaterThan(0);
    for (const item of body.content) {
      expect(item.type).toBe('text');
      expect(typeof item.text).toBe('string');
    }
  });

  test('browser tool handler error returns isError with 422 status', async () => {
    const { handlers, state } = createTestHandlers();

    const mockBrowserTool: CachedBrowserTool = {
      name: 'browser_failing_tool',
      description: 'A browser tool that fails',
      inputSchema: { type: 'object' },
      tool: {
        name: 'browser_failing_tool',
        description: 'A browser tool that fails',
        input: z.object({}),
        handler: async () => {
          throw new Error('Something went wrong');
        },
      },
    };
    state.cachedBrowserTools = [mockBrowserTool];
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/browser_failing_tool/call',
      { arguments: {} },
    );

    expect(status).toBe(422);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain('Something went wrong');
  });

  test('browser tool with invalid args returns validation error', async () => {
    const { handlers, state } = createTestHandlers();

    const mockBrowserTool: CachedBrowserTool = {
      name: 'browser_strict_tool',
      description: 'A browser tool with strict input',
      inputSchema: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] },
      tool: {
        name: 'browser_strict_tool',
        description: 'A browser tool with strict input',
        input: z.object({ tabId: z.number() }),
        handler: async () => ({}),
      },
    };
    state.cachedBrowserTools = [mockBrowserTool];
    state.pluginPermissions = { browser: { permission: 'auto' } };

    const { status, body } = await postJson<ToolCallResponse>(
      handlers,
      'http://localhost:9876/tools/browser_strict_tool/call',
      { arguments: { tabId: 'not-a-number' } },
    );

    expect(status).toBe(422);
    expect(body.isError).toBe(true);
  });
});

describe('multi-connection — wsOpen with explicit connectionId', () => {
  test('two connections with different IDs coexist', () => {
    const { handlers, state } = createTestHandlers();
    const ws1 = createMockWsHandle();
    const ws2 = createMockWsHandle();

    // Set explicit connectionIds via _pendingConnectionId
    state._pendingConnectionId = 'profile-regular';
    handlers.wsOpen(ws1);
    state._pendingConnectionId = 'profile-incognito';
    handlers.wsOpen(ws2);

    expect(state.extensionConnections.size).toBe(2);
    expect(state.extensionConnections.has('profile-regular')).toBe(true);
    expect(state.extensionConnections.has('profile-incognito')).toBe(true);
  });

  test('reconnecting with the same connectionId replaces only that connection', () => {
    const { handlers, state } = createTestHandlers();
    const ws1 = createMockWsHandle();
    const ws2 = createMockWsHandle();
    const wsReconnect = createMockWsHandle();

    state._pendingConnectionId = 'alpha';
    handlers.wsOpen(ws1);
    state._pendingConnectionId = 'beta';
    handlers.wsOpen(ws2);

    expect(state.extensionConnections.size).toBe(2);

    // Reconnect with same connectionId 'alpha'
    state._pendingConnectionId = 'alpha';
    handlers.wsOpen(wsReconnect);

    expect(state.extensionConnections.size).toBe(2);
    expect(state.extensionConnections.get('alpha')?.ws).toBe(wsReconnect);
    expect(state.extensionConnections.get('beta')?.ws).toBe(ws2);
    expect(ws1.closed).toBe(true);
    expect((ws2 as ReturnType<typeof createMockWsHandle>).closed).toBe(false);
  });
});
