import { checkBearerAuth, createHandlers, isLocalhostHost, sweepStaleSessions } from './http-routes.js';
import { buildRegistry } from './registry.js';
import { createState, STATE_SCHEMA_VERSION } from './state.js';
import { version } from './version.js';
import { describe, expect, test } from 'bun:test';
import type { HotHandlers } from './http-routes.js';
import type { McpServerInstance } from './mcp-setup.js';
import type { PendingDispatch } from './state.js';
import type { WsHandle } from '@opentabs-dev/shared';

/** Create a minimal mock McpServerInstance */
const createMockSession = (): McpServerInstance => ({
  setRequestHandler: () => {},
  connect: () => Promise.resolve(),
  sendToolListChanged: () => Promise.resolve(),
  sendResourceListChanged: () => Promise.resolve(),
  sendPromptListChanged: () => Promise.resolve(),
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
  mode: 'dev' | 'production';
  extensionConnected: boolean;
  mcpClients: number;
  plugins: number;
  pluginDetails: { name: string; displayName: string; toolCount: number; tabState: string; source: string }[];
  toolCount: number;
  disabledBrowserTools: string[];
  confirmationBypassed: boolean;
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

    state.registry = buildRegistry(
      [
        {
          name: 'test-plugin',
          version: '1.0.0',
          displayName: 'Test Plugin',
          urlPatterns: ['*://example.com/*'],
          trustTier: 'local',
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
          resources: [],
          prompts: [],
        },
      ],
      [],
    );
    state.tabMapping.set('test-plugin', { state: 'ready', tabId: 1, url: 'https://example.com' });

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
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    const text = await (res as Response).text();

    expect(text).not.toContain(secret);
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

  test('disabledBrowserTools is empty when no tools are disabled', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: {} as never },
    ];

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.disabledBrowserTools).toEqual([]);
  });

  test('disabledBrowserTools lists tools disabled via browserToolPolicy', async () => {
    const { handlers, state } = createTestHandlers();

    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: {} as never },
      { name: 'browser_execute_script', description: 'Execute script', inputSchema: {}, tool: {} as never },
      { name: 'browser_get_cookies', description: 'Get cookies', inputSchema: {}, tool: {} as never },
    ];
    state.browserToolPolicy = { browser_execute_script: false, browser_get_cookies: false };

    const body = await fetchJson<HealthResponse>(handlers, 'http://localhost:9876/health');

    expect(body.disabledBrowserTools).toEqual(['browser_execute_script', 'browser_get_cookies']);
  });

  test('unauthenticated request returns minimal response when secret is set', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const body = await fetchJson<Record<string, unknown>>(handlers, 'http://localhost:9876/health');

    expect(body.status).toBe('ok');
    expect(body.version).toBe(version);
    expect(body.extensionConnected).toBe(false);
    // Minimal response excludes detailed fields
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
    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });
});

describe('/ws-info endpoint', () => {
  test('returns wsUrl without secret when no auth configured', async () => {
    const { handlers } = createTestHandlers();

    const body = await fetchJson<WsInfoResponse>(handlers, 'http://localhost:9876/ws-info');

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
    expect(body).not.toHaveProperty('wsSecret');
  });

  test('returns wsUrl without secret when auth is configured and Bearer token matches', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Host: 'localhost:9876', Authorization: 'Bearer my-test-secret' },
    });
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    const body = (await (res as Response).json()) as WsInfoResponse;

    expect(body.wsUrl).toBe('ws://localhost:9876/ws');
    expect(body).not.toHaveProperty('wsSecret');
  });

  test('returns 401 for unauthenticated requests when auth is configured', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', { headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test('returns 401 for requests with wrong Bearer token', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'my-test-secret';

    const req = new Request('http://localhost:9876/ws-info', {
      headers: { Host: 'localhost:9876', Authorization: 'Bearer wrong-token' },
    });
    const res = await handlers.fetch(req, mockBunServer);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });
});

describe('POST /reload endpoint', () => {
  test('returns 401 without bearer auth', async () => {
    const { handlers, state } = createTestHandlers();
    state.wsSecret = 'test-secret';

    const req = new Request('http://localhost:9876/reload', { method: 'POST', headers: { Host: 'localhost:9876' } });
    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
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
  test('matching ws sets extensionWs to null', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionWs = ws;

    handlers.wsClose(ws);

    expect(state.extensionWs).toBeNull();
  });

  test('matching ws rejects all pending dispatches with "Extension disconnected"', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionWs = ws;

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
    state.extensionWs = ws;

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
    state.extensionWs = currentWs;

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
    expect(state.extensionWs).toBe(currentWs);
    expect(state.pendingDispatches.size).toBe(1);
    expect(errors).toHaveLength(0);

    // Cleanup timer to avoid leaks
    clearTimeout(pending.timerId);
  });

  test('matching ws with no pending dispatches is a no-op (no throw)', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    state.extensionWs = ws;

    expect(() => handlers.wsClose(ws)).not.toThrow();
    expect(state.extensionWs).toBeNull();
    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('wsOpen handler', () => {
  test('assigns new ws to state.extensionWs', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();

    handlers.wsOpen(ws);

    expect(state.extensionWs).toBe(ws);
  });

  test('closes previous ws when replaced by a new connection', () => {
    const { handlers, state } = createTestHandlers();
    const oldWs = createMockWsHandle();
    const newWs = createMockWsHandle();
    state.extensionWs = oldWs;

    handlers.wsOpen(newWs);

    expect(state.extensionWs).toBe(newWs);
    expect(oldWs.closed).toBe(true);
  });

  test('new ws is assigned BEFORE previous ws is closed (ordering test)', () => {
    const { handlers, state } = createTestHandlers();
    const capture = { ws: null as WsHandle | null };
    const oldWs: WsHandle = {
      send() {},
      close() {
        // Capture what state.extensionWs points to at the moment close() is called
        capture.ws = state.extensionWs;
      },
    };
    const newWs = createMockWsHandle();
    state.extensionWs = oldWs;

    handlers.wsOpen(newWs);

    // extensionWs should already point to newWs when oldWs.close() was called
    expect(capture.ws).toBe(newWs);
  });

  test('no previous connection works without error', () => {
    const { handlers, state } = createTestHandlers();
    const ws = createMockWsHandle();
    // extensionWs is null by default

    expect(() => handlers.wsOpen(ws)).not.toThrow();
    expect(state.extensionWs).toBe(ws);
  });
});

describe('CORS protection', () => {
  test('request with Origin: http://evil.com returns 403 Forbidden', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'http://evil.com' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('request with Origin: https://attacker.io returns 403 Forbidden', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'https://attacker.io' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('request with Origin: chrome-extension://abc123 passes through (200)', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9876', Origin: 'chrome-extension://abc123' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with no Origin header passes through (200)', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', { headers: { Host: 'localhost:9876' } });

    const res = await handlers.fetch(req, mockBunServer);

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

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe('Forbidden: invalid Host header');
  });

  test('request with Host: localhost passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: localhost:9515 passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: 'localhost:9515' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: 127.0.0.1 passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: '127.0.0.1' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with Host: [::1] passes through', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health', {
      headers: { Host: '[::1]' },
    });

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
  });

  test('request with missing Host header returns 403', async () => {
    const { handlers } = createTestHandlers();
    const req = new Request('http://localhost:9876/health');

    const res = await handlers.fetch(req, mockBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe('Forbidden: invalid Host header');
  });
});

describe('WebSocket upgrade origin check', () => {
  /** Mock bunServer that reports successful upgrades */
  const upgradingBunServer = {
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

    const res = await handlers.fetch(req, upgradingBunServer);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  test('WS upgrade allowed with no Origin header (proceeds to secret check)', async () => {
    const { handlers } = createTestHandlers();
    // No wsSecret configured, so no auth is needed — upgrade should succeed
    const req = new Request('http://localhost:9876/ws', {
      headers: { Host: 'localhost:9876', Upgrade: 'websocket' },
    });

    const res = await handlers.fetch(req, upgradingBunServer);

    // Successful upgrade returns undefined (Bun convention)
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

    const res = await handlers.fetch(req, upgradingBunServer);

    // Successful upgrade returns undefined (Bun convention)
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
      const res = (await handlers.fetch(req, mockBunServer)) as Response;
      expect(res.status).toBe(400);
    }

    // 6th request should be rate-limited
    const req = new Request('http://localhost:9876/mcp', {
      method: 'POST',
      headers: { Host: 'localhost:9876', 'Content-Type': 'application/json' },
      body: JSON.stringify({ not: 'an initialize request' }),
    });
    const res = (await handlers.fetch(req, mockBunServer)) as Response;
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
      await handlers.fetch(req, mockBunServer);
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
    const res = (await handlers.fetch(req, mockBunServer)) as Response;
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
      await handlers.fetch(req, mockBunServer);
    }

    // GET requests should not be rate-limited
    const req = new Request('http://localhost:9876/mcp', {
      method: 'GET',
      headers: { Host: 'localhost:9876' },
    });
    const res = (await handlers.fetch(req, mockBunServer)) as Response;
    // GET without session ID returns 400, not 429
    expect(res.status).toBe(400);
  });
});
