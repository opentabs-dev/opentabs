import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WsHandle } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  dispatchToAllConnections,
  dispatchToExtension,
  handleExtensionMessage,
  isDispatchError,
  queryExtension,
  rejectAllPendingConfirmations,
  sendConfirmationRequest,
  sendSyncFull,
  writeAdapterFile,
  writeAllAdapterFiles,
} from './extension-protocol.js';
import { buildRegistry } from './registry.js';
import type { ConfirmationDecision, ExtensionConnection, PendingDispatch, RegisteredPlugin } from './state.js';
import { createState, DISPATCH_TIMEOUT_MS, getMergedTabMapping, MAX_DISPATCH_TIMEOUT_MS } from './state.js';

/** Create a mock WsHandle that records sent messages */
const createMockWs = (): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {},
});

/** No-op MCP callbacks for tests that don't exercise config changes */
const noopCallbacks = {
  onToolConfigChanged: () => {},
  onPluginPermissionsPersist: () => {},
  onPluginSettingsPersist: () => {},
  onPluginLog: () => {},
  onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
  queryExtension: () => Promise.resolve(undefined),
};

/** Type-safe JSON parse returning a typed record */
const parseJson = (
  text: string,
): { jsonrpc?: string; method?: string; id?: number; error?: { code: number; message: string } } =>
  JSON.parse(text) as { jsonrpc?: string; method?: string; id?: number; error?: { code: number; message: string } };

describe('handleExtensionMessage — ping', () => {
  test('ping replies with pong on the sender ws, not the connection ws', () => {
    const state = createState();
    const extensionWs = createMockWs();
    const senderWs = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: extensionWs,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'ping' }), noopCallbacks, senderWs);

    expect(senderWs.sent).toHaveLength(1);
    const raw = senderWs.sent[0];
    expect(raw).toBeDefined();
    expect(parseJson(raw as string)).toEqual({ jsonrpc: '2.0', method: 'pong' });
    expect(extensionWs.sent).toHaveLength(0);
  });

  test('ping falls back to any active connection when no senderWs provided', () => {
    const state = createState();
    const extensionWs = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: extensionWs,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'ping' }), noopCallbacks);

    expect(extensionWs.sent).toHaveLength(1);
    const raw = extensionWs.sent[0];
    expect(raw).toBeDefined();
    expect(parseJson(raw as string)).toEqual({ jsonrpc: '2.0', method: 'pong' });
  });
});

describe('handleExtensionMessage — response settlement', () => {
  test('result message resolves the correct pending dispatch', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let resolved: unknown;
    const pending: PendingDispatch = {
      resolve: val => {
        resolved = val;
      },
      reject: () => {},
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(42, pending);

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', id: 42, result: { data: 'hello' } }), noopCallbacks);

    expect(resolved).toEqual({ data: 'hello' });
    expect(state.pendingDispatches.has(42)).toBe(false);
  });

  test('error response rejects the pending dispatch with DispatchError', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let rejected: unknown;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(99, pending);

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', id: 99, error: { code: -32001, message: 'Tab closed' } }),
      noopCallbacks,
    );

    expect(rejected).toBeDefined();
    expect(isDispatchError(rejected)).toBe(true);
    const err = rejected as { name: string; message: string; code: number };
    expect(err.message).toBe('Tab closed');
    expect(err.code).toBe(-32001);
    expect(state.pendingDispatches.has(99)).toBe(false);
  });

  test('error response with data.code propagates the ToolError code', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let rejected: unknown;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(77, pending);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 77,
        error: { code: -32603, message: 'Channel not found', data: { code: 'CHANNEL_NOT_FOUND' } },
      }),
      noopCallbacks,
    );

    expect(rejected).toBeDefined();
    expect(isDispatchError(rejected)).toBe(true);
    const err = rejected as { name: string; message: string; code: number; data?: Record<string, unknown> };
    expect(err.message).toBe('Channel not found');
    expect(err.code).toBe(-32603);
    expect(err.data).toEqual({ code: 'CHANNEL_NOT_FOUND' });
  });

  test('error response with structured ToolError fields propagates all fields in data', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let rejected: unknown;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(80, pending);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 80,
        error: {
          code: -32603,
          message: 'Too many requests',
          data: { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 5000, category: 'rate_limit' },
        },
      }),
      noopCallbacks,
    );

    expect(rejected).toBeDefined();
    expect(isDispatchError(rejected)).toBe(true);
    const err = rejected as { name: string; message: string; code: number; data?: Record<string, unknown> };
    expect(err.message).toBe('Too many requests');
    expect(err.code).toBe(-32603);
    expect(err.data).toEqual({ code: 'RATE_LIMITED', retryable: true, retryAfterMs: 5000, category: 'rate_limit' });
  });

  test('error response with partial structured fields propagates only present fields', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let rejected: unknown;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(81, pending);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 81,
        error: {
          code: -32603,
          message: 'Auth failed',
          data: { code: 'AUTH_ERROR', category: 'auth' },
        },
      }),
      noopCallbacks,
    );

    expect(rejected).toBeDefined();
    expect(isDispatchError(rejected)).toBe(true);
    const err = rejected as { name: string; message: string; code: number; data?: Record<string, unknown> };
    expect(err.data).toEqual({ code: 'AUTH_ERROR', category: 'auth' });
  });

  test('error response without data field has undefined data', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let rejected: unknown;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, 60_000),
    };
    state.pendingDispatches.set(78, pending);

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', id: 78, error: { code: -32603, message: 'Some error' } }),
      noopCallbacks,
    );

    expect(rejected).toBeDefined();
    expect(isDispatchError(rejected)).toBe(true);
    const err = rejected as { name: string; message: string; code: number; data?: Record<string, unknown> };
    expect(err.data).toBeUndefined();
  });

  test('response for unknown id is silently ignored', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', id: 123, result: {} }), noopCallbacks);

    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('isDispatchError', () => {
  test('returns true for DispatchError-shaped objects', () => {
    const err = { name: 'DispatchError', message: 'test', code: -32000 };
    expect(isDispatchError(err)).toBe(true);
  });

  test('returns false for plain Error', () => {
    expect(isDispatchError(new Error('test'))).toBe(false);
  });

  test('returns false for null', () => {
    expect(isDispatchError(null)).toBe(false);
  });

  test('returns false for non-object', () => {
    expect(isDispatchError('string')).toBe(false);
  });

  test('returns false for object missing code', () => {
    expect(isDispatchError({ name: 'DispatchError', message: 'test' })).toBe(false);
  });

  test('returns false for object with wrong name', () => {
    expect(isDispatchError({ name: 'TypeError', message: 'test', code: -1 })).toBe(false);
  });
});

describe('handleExtensionMessage — tab.syncAll', () => {
  test('updates getMergedTabMapping(state) with all entries', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.syncAll',
        params: {
          tabs: {
            slack: {
              state: 'ready',
              tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
            },
            github: {
              state: 'unavailable',
              tabs: [{ tabId: 20, url: 'https://github.com', title: 'GitHub', ready: false }],
            },
          },
        },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(2);
    expect(getMergedTabMapping(state).get('slack')).toEqual({
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    expect(getMergedTabMapping(state).get('github')).toEqual({
      state: 'unavailable',
      tabs: [{ tabId: 20, url: 'https://github.com', title: 'GitHub', ready: false }],
    });
  });

  test('clears previous tabMapping entries on sync', () => {
    const state = createState();
    const conn: ExtensionConnection = {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    conn.tabMapping.set('old-plugin', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://old.com', title: 'Old', ready: true }],
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.syncAll',
        params: {
          tabs: { slack: { state: 'closed', tabs: [] } },
        },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(1);
    expect(getMergedTabMapping(state).has('old-plugin')).toBe(false);
    expect(getMergedTabMapping(state).get('slack')).toEqual({ state: 'closed', tabs: [] });
  });
});

describe('handleExtensionMessage — tab.stateChanged', () => {
  const makePlugin = (name: string): RegisteredPlugin => ({
    name,
    version: '1.0.0',
    displayName: name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
  });

  test('updates a single entry in getMergedTabMapping(state)', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.registry = buildRegistry([makePlugin('slack')], []);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: {
          plugin: 'slack',
          state: 'ready',
          tabs: [{ tabId: 5, url: 'https://app.slack.com', title: 'Slack', ready: true }],
        },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(1);
    expect(getMergedTabMapping(state).get('slack')).toEqual({
      state: 'ready',
      tabs: [{ tabId: 5, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
  });

  test('does not affect other entries in tabMapping', () => {
    const state = createState();
    const conn: ExtensionConnection = {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    state.registry = buildRegistry([makePlugin('slack'), makePlugin('github')], []);
    conn.tabMapping.set('github', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://github.com', title: 'GitHub', ready: true }],
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: { plugin: 'slack', state: 'closed', tabs: [] },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(2);
    expect(getMergedTabMapping(state).get('github')).toEqual({
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://github.com', title: 'GitHub', ready: true }],
    });
    expect(getMergedTabMapping(state).get('slack')).toEqual({ state: 'closed', tabs: [] });
  });

  test('rejects unknown plugin name', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        id: 1,
        params: { plugin: 'nonexistent', state: 'ready' },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(0);
    expect(ws.sent).toHaveLength(1);
    const response = parseJson(ws.sent[0] as string);
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('Unknown plugin');
  });

  test('rejects invalid tab state value', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.registry = buildRegistry([makePlugin('slack')], []);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        id: 2,
        params: { plugin: 'slack', state: 'invalid-state' },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).has('slack')).toBe(false);
    expect(ws.sent).toHaveLength(1);
    const response = parseJson(ws.sent[0] as string);
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('Invalid tab state');
  });

  test('logs warning for unknown plugin when no id present', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: { plugin: 'nonexistent', state: 'ready' },
      }),
      noopCallbacks,
    );

    expect(getMergedTabMapping(state).size).toBe(0);
  });
});

describe('handleExtensionMessage — unrecognized method', () => {
  test('unrecognized method with id sends -32601 error response', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'unknown.method', id: 7 }), noopCallbacks);

    expect(ws.sent).toHaveLength(1);
    const raw = ws.sent[0];
    expect(raw).toBeDefined();
    const response = parseJson(raw as string);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(7);
    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toContain('unknown.method');
  });
});

describe('handleExtensionMessage — message size limit', () => {
  test('message at exactly MAX_MESSAGE_SIZE (10MB) is processed normally', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    // Build a valid JSON-RPC ping message, then pad it to exactly 10MB
    const base = JSON.stringify({ jsonrpc: '2.0', method: 'ping' });
    const maxSize = 10 * 1024 * 1024;
    // Pad with spaces (valid JSON whitespace) to reach exactly the limit
    const atLimit = base + ' '.repeat(maxSize - base.length);
    expect(atLimit.length).toBe(maxSize);

    handleExtensionMessage(state, atLimit, noopCallbacks, ws);

    // The message was processed — ping handler sent a pong reply
    expect(ws.sent).toHaveLength(1);
    const response = parseJson(ws.sent[0] as string);
    expect(response.method).toBe('pong');
  });

  test('message exceeding MAX_MESSAGE_SIZE (10MB) is dropped without processing', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    // Create a message one byte over the 10MB limit
    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);

    handleExtensionMessage(state, oversized, noopCallbacks);

    // No messages sent (not parsed, not dispatched)
    expect(ws.sent).toHaveLength(0);
    expect(getMergedTabMapping(state).size).toBe(0);
    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('handleExtensionMessage — malformed JSON', () => {
  test('malformed JSON is dropped gracefully', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, 'not valid json{{{', noopCallbacks);

    expect(getMergedTabMapping(state).size).toBe(0);
    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('sendSyncFull', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const setupTmpConfigDir = (): void => {
    originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-test-'));
    process.env.OPENTABS_CONFIG_DIR = tmpDir;
  };

  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    displayName: overrides.name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('sends sync.full with correct plugin metadata and tool enabled state', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'alpha',
          version: '1.0.0',
          urlPatterns: ['http://alpha.com/*'],
          iife: '// alpha iife',
          tools: [
            {
              name: 'ping',
              displayName: 'Ping',
              description: 'Ping',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
        makePlugin({
          name: 'beta',
          version: '2.0.0',
          urlPatterns: ['http://beta.com/*'],
          iife: '// beta iife',
          tools: [
            {
              name: 'pong',
              displayName: 'Pong',
              description: 'Pong',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    // alpha_ping enabled (default), beta_pong explicitly disabled
    state.pluginPermissions = { beta: { tools: { pong: 'off' } } };

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const rawSync = ws.sent[0];
    expect(rawSync).toBeDefined();
    const msg = JSON.parse(rawSync as string) as {
      jsonrpc: string;
      method: string;
      params: {
        plugins: {
          name: string;
          version: string;
          urlPatterns: string[];
          displayName: string;
          sourcePath: string | undefined;
          adapterHash: string | undefined;
          source: string;
          tools: { name: string; displayName: string; description: string; icon: string; permission: string }[];
        }[];
        failedPlugins: { specifier: string; error: string }[];
        browserTools: { name: string; description: string; permission: string }[];
        serverVersion: string;
      };
    };

    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('sync.full');
    expect(msg.params.plugins).toHaveLength(2);

    // Verify server-owned top-level fields are present
    expect(msg.params.failedPlugins).toEqual([]);
    expect(Array.isArray(msg.params.browserTools)).toBe(true);
    expect(typeof msg.params.serverVersion).toBe('string');

    // Sort by name for deterministic assertions (Map iteration order matches insertion order,
    // but sorting makes the test resilient to refactoring)
    const sorted = [...msg.params.plugins].sort((a, b) => a.name.localeCompare(b.name));

    const firstPlugin = sorted[0];
    expect(firstPlugin).toBeDefined();
    expect(firstPlugin).toMatchObject({
      name: 'alpha',
      version: '1.0.0',
      urlPatterns: ['http://alpha.com/*'],
      displayName: 'alpha',
      source: 'local',
      tools: [{ name: 'ping', displayName: 'Ping', description: 'Ping', icon: 'wrench', permission: 'off' }],
    });
    // adapterFile is now included with content-hashed path
    expect(typeof (firstPlugin as Record<string, unknown>).adapterFile).toBe('string');

    const secondPlugin = sorted[1];
    expect(secondPlugin).toBeDefined();
    expect(secondPlugin).toMatchObject({
      name: 'beta',
      version: '2.0.0',
      urlPatterns: ['http://beta.com/*'],
      displayName: 'beta',
      source: 'local',
      tools: [{ name: 'pong', displayName: 'Pong', description: 'Pong', icon: 'wrench', permission: 'off' }],
    });
    expect(typeof (secondPlugin as Record<string, unknown>).adapterFile).toBe('string');
  });

  test('writes adapter IIFE files to the adapters directory with hashed filename', async () => {
    setupTmpConfigDir();
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'test-plugin',
          iife: '(function(){/* adapter */})()',
          tools: [
            {
              name: 'echo',
              displayName: 'Echo',
              description: 'Echo',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    await sendSyncFull(state);

    const adaptersDir = join(tmpDir, 'extension', 'adapters');
    const entries = await readdir(adaptersDir);
    const hashedFile = entries.find(f => f.startsWith('test-plugin-') && f.endsWith('.js'));
    expect(hashedFile).toBeDefined();
    if (!hashedFile) return; // Unreachable after expect, satisfies TypeScript
    const content = await readFile(join(adaptersDir, hashedFile), 'utf-8');
    expect(content).toBe('(function(){/* adapter */})()');
  });

  test('sends sync.full even when no extension is connected (message is silently dropped)', async () => {
    setupTmpConfigDir();
    const state = createState();

    state.registry = buildRegistry([makePlugin({ name: 'alpha', iife: '// alpha' })], []);

    // Should not throw
    await sendSyncFull(state);

    // Adapter file is still written with hashed filename
    const adaptersDir = join(tmpDir, 'extension', 'adapters');
    const entries = await readdir(adaptersDir);
    const hashedFile = entries.find(f => f.startsWith('alpha-') && f.endsWith('.js'));
    expect(hashedFile).toBeDefined();
    if (!hashedFile) return; // Unreachable after expect, satisfies TypeScript
    const content = await readFile(join(adaptersDir, hashedFile), 'utf-8');
    expect(content).toBe('// alpha');
  });

  test('sends empty plugins array when no plugins are registered', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const rawEmpty = ws.sent[0];
    expect(rawEmpty).toBeDefined();
    const msg = JSON.parse(rawEmpty as string) as {
      params: { plugins: unknown[]; failedPlugins: unknown[]; browserTools: unknown[]; serverVersion: string };
    };
    expect(msg.params.plugins).toEqual([]);
    expect(msg.params.failedPlugins).toEqual([]);
    expect(Array.isArray(msg.params.browserTools)).toBe(true);
    expect(typeof msg.params.serverVersion).toBe('string');
  });

  test('includes browserPermission in sync.full payload', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.pluginPermissions = { browser: { permission: 'ask' } };

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0] as string) as {
      params: { browserPermission?: string };
    };
    expect(msg.params.browserPermission).toBe('ask');
  });

  test('browserPermission defaults to "off" in sync.full when not configured', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0] as string) as {
      params: { browserPermission?: string };
    };
    expect(msg.params.browserPermission).toBe('off');
  });

  test('includes iconSvg and iconInactiveSvg in sync.full payload when present', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'icon-plugin',
          iconSvg: '<svg>active</svg>',
          iconInactiveSvg: '<svg>inactive</svg>',
          tools: [
            {
              name: 'my-tool',
              displayName: 'My Tool',
              description: 'A tool',
              icon: 'wrench',
              iconSvg: '<svg>tool-active</svg>',
              iconInactiveSvg: '<svg>tool-inactive</svg>',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const rawIcon = ws.sent[0];
    expect(rawIcon).toBeDefined();
    const msg = JSON.parse(rawIcon as string) as {
      params: {
        plugins: {
          name: string;
          iconSvg?: string;
          iconInactiveSvg?: string;
          tools: { name: string; iconSvg?: string; iconInactiveSvg?: string }[];
        }[];
      };
    };

    const plugin = msg.params.plugins[0];
    expect(plugin).toBeDefined();
    expect(plugin?.iconSvg).toBe('<svg>active</svg>');
    expect(plugin?.iconInactiveSvg).toBe('<svg>inactive</svg>');

    const tool = plugin?.tools[0];
    expect(tool).toBeDefined();
    expect(tool?.iconSvg).toBe('<svg>tool-active</svg>');
    expect(tool?.iconInactiveSvg).toBe('<svg>tool-inactive</svg>');
  });

  test('omits iconSvg and iconInactiveSvg from sync.full payload when absent', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'no-icon-plugin',
          tools: [
            {
              name: 'plain-tool',
              displayName: 'Plain Tool',
              description: 'No icon',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const rawNoIcon = ws.sent[0];
    expect(rawNoIcon).toBeDefined();
    const msg = JSON.parse(rawNoIcon as string) as {
      params: {
        plugins: Record<string, unknown>[];
      };
    };

    const plugin = msg.params.plugins[0];
    expect(plugin).toBeDefined();
    expect('iconSvg' in (plugin as Record<string, unknown>)).toBe(false);
    expect('iconInactiveSvg' in (plugin as Record<string, unknown>)).toBe(false);
  });

  test('includes per-plugin source, sdkVersion, and update in sync.full payload', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'npm-plugin',
          source: 'npm',
          sdkVersion: '1.2.3',
          npmPackageName: 'opentabs-plugin-npm-plugin',
        }),
        makePlugin({
          name: 'local-plugin',
          source: 'local',
        }),
      ],
      [],
    );

    // Simulate an outdated npm plugin
    state.outdatedPlugins = [
      {
        name: 'opentabs-plugin-npm-plugin',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateCommand: 'npm install -g ...',
      },
    ];

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0] as string) as {
      params: { plugins: Record<string, unknown>[] };
    };
    const sorted = [...msg.params.plugins].sort((a, b) => (a.name as string).localeCompare(b.name as string));

    // local-plugin: source=local, no sdkVersion, no update
    const local = sorted[0];
    expect(local).toBeDefined();
    expect(local?.source).toBe('local');
    expect('sdkVersion' in (local as Record<string, unknown>)).toBe(false);
    expect('update' in (local as Record<string, unknown>)).toBe(false);

    // npm-plugin: source=npm, sdkVersion present, update present
    const npm = sorted[1];
    expect(npm).toBeDefined();
    expect(npm?.source).toBe('npm');
    expect(npm?.sdkVersion).toBe('1.2.3');
    expect(npm?.update).toEqual({ latestVersion: '2.0.0', updateCommand: 'npm install -g ...' });
  });
});

describe('writeAllAdapterFiles', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-test-writeall-'));
    process.env.OPENTABS_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    displayName: overrides.name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('writes adapter .js files for each plugin and returns a Map of name to path', async () => {
    const state = createState();
    // No extension connections — writeAllAdapterFiles works without them
    state.registry = buildRegistry(
      [makePlugin({ name: 'foo', iife: '// foo adapter' }), makePlugin({ name: 'bar', iife: '// bar adapter' })],
      [],
    );

    const result = await writeAllAdapterFiles(state);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.has('foo')).toBe(true);
    expect(result.has('bar')).toBe(true);

    const adaptersDir = join(tmpDir, 'extension', 'adapters');
    const entries = await readdir(adaptersDir);

    const fooFile = entries.find(f => f.startsWith('foo-') && f.endsWith('.js'));
    expect(fooFile).toBeDefined();
    const fooContent = await readFile(join(adaptersDir, fooFile as string), 'utf-8');
    expect(fooContent).toBe('// foo adapter');

    const barFile = entries.find(f => f.startsWith('bar-') && f.endsWith('.js'));
    expect(barFile).toBeDefined();
    const barContent = await readFile(join(adaptersDir, barFile as string), 'utf-8');
    expect(barContent).toBe('// bar adapter');
  });

  test('works when extensionConnections is empty (no extension connected)', async () => {
    const state = createState();
    expect(state.extensionConnections.size).toBe(0);

    state.registry = buildRegistry([makePlugin({ name: 'solo', iife: '// solo iife' })], []);

    const result = await writeAllAdapterFiles(state);

    expect(result.size).toBe(1);
    expect(result.has('solo')).toBe(true);

    const adaptersDir = join(tmpDir, 'extension', 'adapters');
    const entries = await readdir(adaptersDir);
    const soloFile = entries.find(f => f.startsWith('solo-') && f.endsWith('.js'));
    expect(soloFile).toBeDefined();
    const content = await readFile(join(adaptersDir, soloFile as string), 'utf-8');
    expect(content).toBe('// solo iife');
  });

  test('cleans up stale adapter files for removed plugins', async () => {
    const state = createState();

    // First call: write adapter for 'old-plugin'
    state.registry = buildRegistry([makePlugin({ name: 'old-plugin', iife: '// old iife' })], []);
    await writeAllAdapterFiles(state);

    const adaptersDir = join(tmpDir, 'extension', 'adapters');
    let entries = await readdir(adaptersDir);
    expect(entries.find(f => f.startsWith('old-plugin-') && f.endsWith('.js'))).toBeDefined();

    // Second call: registry now has only 'new-plugin' (old-plugin removed)
    state.registry = buildRegistry([makePlugin({ name: 'new-plugin', iife: '// new iife' })], []);
    await writeAllAdapterFiles(state);

    entries = await readdir(adaptersDir);
    // Old plugin's adapter is cleaned up
    expect(entries.find(f => f.startsWith('old-plugin-') && f.endsWith('.js'))).toBeUndefined();
    // New plugin's adapter exists
    expect(entries.find(f => f.startsWith('new-plugin-') && f.endsWith('.js'))).toBeDefined();
  });

  test('returns empty Map when no plugins are registered', async () => {
    const state = createState();
    // Default empty registry

    const result = await writeAllAdapterFiles(state);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });
});

describe('dispatchToExtension', () => {
  test('rejects immediately when no connections exist', async () => {
    const state = createState();

    await expect(dispatchToExtension(state, 'tool.dispatch', { tool: 'test' })).rejects.toThrow(
      'Extension not connected',
    );
  });

  test('sends JSON-RPC request and creates a pending dispatch entry', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    // Start dispatch but don't await — we just want to verify the side effects
    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    expect(ws.sent).toHaveLength(1);
    const rawDispatch = ws.sent[0];
    expect(rawDispatch).toBeDefined();
    const sent = parseJson(rawDispatch as string);
    expect(sent.jsonrpc).toBe('2.0');

    const id = sent.id;
    expect(typeof id).toBe('string');
    expect(id).toBeDefined();

    const pending = state.pendingDispatches.get(id ?? '');
    expect(pending).toBeDefined();
    expect(pending?.label).toBe('slack/echo');

    // Settle the dispatch to prevent timeout leak
    pending?.resolve('done');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('injects __opentabs_dispatchId (not dispatchId) into sent params', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    const rawMsg = ws.sent[0];
    expect(rawMsg).toBeDefined();
    const sent = JSON.parse(rawMsg as string) as {
      id: string;
      params: { __opentabs_dispatchId?: string; dispatchId?: unknown };
    };

    // Platform-namespaced field must be present and equal to the message id
    expect(typeof sent.params.__opentabs_dispatchId).toBe('string');
    expect(sent.params.__opentabs_dispatchId).toBe(sent.id);

    // Legacy field must NOT be injected by the platform
    expect(sent.params.dispatchId).toBeUndefined();

    // Settle the dispatch to prevent timeout leak
    const pending = state.pendingDispatches.get(sent.id);
    pending?.resolve('done');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('dispatch can be settled by handleExtensionMessage response', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(state, 'tool.dispatch', { tool: 'test' });

    const rawSettle = ws.sent[0];
    expect(rawSettle).toBeDefined();
    const sent = parseJson(rawSettle as string);
    const id = sent.id ?? '';

    // Simulate extension response
    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', id, result: { output: 'success' } }), noopCallbacks);

    const result = await promise;
    expect(result).toEqual({ output: 'success' });
    expect(state.pendingDispatches.has(id)).toBe(false);
  });
});

describe('handleExtensionMessage — config.getState', () => {
  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    displayName: overrides.name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('returns plugins with displayName, version, tabState, urlPatterns, and tools', () => {
    const state = createState();
    const ws = createMockWs();
    const conn: ExtensionConnection = {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'test-plugin',
          displayName: 'Test Plugin',
          version: '2.1.0',
          urlPatterns: ['http://test.com/*'],
          tools: [
            {
              name: 'ping',
              displayName: 'Ping',
              description: 'Ping tool',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
            {
              name: 'pong',
              displayName: 'Pong',
              description: 'Pong tool',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );
    conn.tabMapping.set('test-plugin', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'http://test.com', title: 'Test', ready: true }],
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 1 }), noopCallbacks);

    expect(ws.sent).toHaveLength(1);
    const rawState = ws.sent[0];
    expect(rawState).toBeDefined();
    const response = JSON.parse(rawState as string) as {
      jsonrpc: string;
      id: number;
      result: {
        plugins: {
          name: string;
          displayName: string;
          version: string;
          source: string;
          tabState: string;
          urlPatterns: string[];
          tools: { name: string; displayName: string; description: string; icon: string; permission: string }[];
        }[];
        failedPlugins: unknown[];
      };
    };

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result.plugins).toHaveLength(1);

    const pluginRaw = response.result.plugins[0];
    expect(pluginRaw).toBeDefined();
    const plugin = pluginRaw as NonNullable<typeof pluginRaw>;
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.displayName).toBe('Test Plugin');
    expect(plugin.version).toBe('2.1.0');
    expect(plugin.source).toBe('local');
    expect(plugin.tabState).toBe('ready');
    expect(plugin.urlPatterns).toEqual(['http://test.com/*']);
    expect(plugin.tools).toHaveLength(2);
    const pingTool = plugin.tools[0];
    expect(pingTool).toBeDefined();
    expect(pingTool).toEqual({
      name: 'ping',
      displayName: 'Ping',
      description: 'Ping tool',
      icon: 'wrench',
      permission: 'off',
    });
    const pongTool = plugin.tools[1];
    expect(pongTool).toBeDefined();
    expect(pongTool).toEqual({
      name: 'pong',
      displayName: 'Pong',
      description: 'Pong tool',
      icon: 'wrench',
      permission: 'off',
    });
  });

  test('tools respect permission state from pluginPermissions', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'enabled-tool',
              displayName: 'Enabled Tool',
              description: 'Enabled',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
            {
              name: 'disabled-tool',
              displayName: 'Disabled Tool',
              description: 'Disabled',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );
    state.pluginPermissions = { 'my-plugin': { tools: { 'disabled-tool': 'off' } } };

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 2 }), noopCallbacks);

    const rawConfig = ws.sent[0];
    expect(rawConfig).toBeDefined();
    const response = JSON.parse(rawConfig as string) as {
      result: {
        plugins: {
          tools: { name: string; displayName: string; description: string; icon: string; permission: string }[];
        }[];
      };
    };
    const pluginEntry = response.result.plugins[0];
    expect(pluginEntry).toBeDefined();
    const tools = (pluginEntry as NonNullable<typeof pluginEntry>).tools;

    const enabledTool = tools[0];
    expect(enabledTool).toBeDefined();
    expect(enabledTool).toEqual({
      name: 'enabled-tool',
      displayName: 'Enabled Tool',
      description: 'Enabled',
      icon: 'wrench',
      permission: 'off',
    });
    const disabledTool = tools[1];
    expect(disabledTool).toBeDefined();
    expect(disabledTool).toEqual({
      name: 'disabled-tool',
      displayName: 'Disabled Tool',
      description: 'Disabled',
      icon: 'wrench',
      permission: 'off',
    });
  });

  test('attaches update info on matching plugin from state.outdatedPlugins', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          npmPackageName: 'opentabs-plugin-my',
        }),
      ],
      [],
    );

    state.outdatedPlugins = [
      {
        name: 'opentabs-plugin-my',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateCommand: 'npm update -g opentabs-plugin-my',
      },
    ];

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 3 }), noopCallbacks);

    const rawOutdated = ws.sent[0];
    expect(rawOutdated).toBeDefined();
    const response = JSON.parse(rawOutdated as string) as {
      result: {
        plugins: { name: string; update?: { latestVersion: string; updateCommand: string } }[];
      };
    };

    expect(response.result.plugins).toHaveLength(1);
    const pluginRaw = response.result.plugins[0];
    expect(pluginRaw).toBeDefined();
    const plugin = pluginRaw as NonNullable<typeof pluginRaw>;
    expect(plugin.update).toEqual({
      latestVersion: '2.0.0',
      updateCommand: 'npm update -g opentabs-plugin-my',
    });
  });

  test('tabState defaults to closed when no tabMapping entry exists', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'unmapped-plugin',
          tools: [
            {
              name: 'test',
              displayName: 'Test',
              description: 'Test',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );
    // No tabMapping entry for 'unmapped-plugin'

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 4 }), noopCallbacks);

    const rawTab = ws.sent[0];
    expect(rawTab).toBeDefined();
    const response = JSON.parse(rawTab as string) as {
      result: { plugins: { name: string; tabState: string }[] };
    };

    const unmappedPlugin = response.result.plugins[0];
    expect(unmappedPlugin).toBeDefined();
    expect((unmappedPlugin as NonNullable<typeof unmappedPlugin>).tabState).toBe('closed');
  });

  test('displayName falls back to name when not set', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry([makePlugin({ name: 'no-display' })], []);

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 5 }), noopCallbacks);

    const rawDisplay = ws.sent[0];
    expect(rawDisplay).toBeDefined();
    const response = JSON.parse(rawDisplay as string) as {
      result: { plugins: { name: string; displayName: string }[] };
    };

    const displayPlugin = response.result.plugins[0];
    expect(displayPlugin).toBeDefined();
    expect((displayPlugin as NonNullable<typeof displayPlugin>).displayName).toBe('no-display');
  });

  test('returns empty plugins array when no plugins are registered', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 6 }), noopCallbacks);

    const rawEmptyPlugins = ws.sent[0];
    expect(rawEmptyPlugins).toBeDefined();
    const response = JSON.parse(rawEmptyPlugins as string) as {
      result: { plugins: unknown[] };
    };

    expect(response.result.plugins).toEqual([]);
  });

  test('includes iconSvg and iconInactiveSvg in config.getState response when present', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'icon-plugin',
          iconSvg: '<svg>active</svg>',
          iconInactiveSvg: '<svg>inactive</svg>',
          tools: [
            {
              name: 'my-tool',
              displayName: 'My Tool',
              description: 'A tool with icon',
              icon: 'wrench',
              iconSvg: '<svg>tool-active</svg>',
              iconInactiveSvg: '<svg>tool-inactive</svg>',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 7 }), noopCallbacks);

    const rawIcon = ws.sent[0];
    expect(rawIcon).toBeDefined();
    const response = JSON.parse(rawIcon as string) as {
      result: {
        plugins: {
          name: string;
          iconSvg?: string;
          iconInactiveSvg?: string;
          tools: { name: string; iconSvg?: string; iconInactiveSvg?: string }[];
        }[];
      };
    };

    const plugin = response.result.plugins[0];
    expect(plugin).toBeDefined();
    expect(plugin?.iconSvg).toBe('<svg>active</svg>');
    expect(plugin?.iconInactiveSvg).toBe('<svg>inactive</svg>');

    const tool = plugin?.tools[0];
    expect(tool).toBeDefined();
    expect(tool?.iconSvg).toBe('<svg>tool-active</svg>');
    expect(tool?.iconInactiveSvg).toBe('<svg>tool-inactive</svg>');
  });

  test('omits iconSvg and iconInactiveSvg from config.getState response when absent', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'plain-plugin',
          tools: [
            {
              name: 'plain-tool',
              displayName: 'Plain Tool',
              description: 'No icons',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 8 }), noopCallbacks);

    const rawNoIcon = ws.sent[0];
    expect(rawNoIcon).toBeDefined();
    const response = JSON.parse(rawNoIcon as string) as {
      result: { plugins: Record<string, unknown>[] };
    };

    const plugin = response.result.plugins[0] as Record<string, unknown> | undefined;
    expect(plugin).toBeDefined();
    expect('iconSvg' in (plugin as Record<string, unknown>)).toBe(false);
    expect('iconInactiveSvg' in (plugin as Record<string, unknown>)).toBe(false);
  });
});

describe('handleExtensionMessage — config.setToolPermission', () => {
  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    displayName: overrides.name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('valid params updates pluginPermissions and sends { ok: true }', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'Send',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onPluginPermissionsPersist: () => {
        configPersistCalled = true;
      },
      onPluginSettingsPersist: () => {},
      onPluginLog: () => {},
      onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
      queryExtension: () => Promise.resolve(undefined),
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'send', permission: 'ask' },
        id: 1,
      }),
      callbacks,
    );

    expect(state.pluginPermissions['my-plugin']?.tools?.send).toBe('ask');
    expect(configChangedCalled).toBe(true);
    expect(configPersistCalled).toBe(true);

    // First message is plugins.changed notification, second is the result
    expect(ws.sent).toHaveLength(2);
    const rawOk = ws.sent[1];
    expect(rawOk).toBeDefined();
    const response = JSON.parse(rawOk as string) as { jsonrpc: string; id: number; result: { ok: boolean } };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ ok: true });
  });

  test('enabling a tool sets pluginPermissions to auto', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.pluginPermissions = { 'my-plugin': { tools: { send: 'off' } } };

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'Send',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'send', permission: 'auto' },
        id: 2,
      }),
      noopCallbacks,
    );

    expect(state.pluginPermissions['my-plugin']?.tools?.send).toBe('auto');

    // First message is plugins.changed notification, second is the result
    const rawEnable = ws.sent[1];
    expect(rawEnable).toBeDefined();
    const response = JSON.parse(rawEnable as string) as { result: { ok: boolean } };
    expect(response.result).toEqual({ ok: true });
  });

  test('missing params sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', method: 'config.setToolPermission', id: 3 }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawMissing = ws.sent[0];
    expect(rawMissing).toBeDefined();
    const response = JSON.parse(rawMissing as string) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(3);
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Missing params');
  });

  test('invalid param types sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'send', permission: 123 },
        id: 4,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawInvalid = ws.sent[0];
    expect(rawInvalid).toBeDefined();
    const response = JSON.parse(rawInvalid as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid params');
  });

  test('missing permission field sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'send' },
        id: 5,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawPermission = ws.sent[0];
    expect(rawPermission).toBeDefined();
    const response = JSON.parse(rawPermission as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid params');
  });

  test('callbacks are not invoked on invalid params', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onPluginPermissionsPersist: () => {
        configPersistCalled = true;
      },
      onPluginSettingsPersist: () => {},
      onPluginLog: () => {},
      onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
      queryExtension: () => Promise.resolve(undefined),
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 123, tool: 'send', permission: 'auto' },
        id: 6,
      }),
      callbacks,
    );

    expect(configChangedCalled).toBe(false);
    expect(configPersistCalled).toBe(false);
  });

  test('nonexistent plugin sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'nonexistent', tool: 'send', permission: 'auto' },
        id: 7,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawNonexistent = ws.sent[0];
    expect(rawNonexistent).toBeDefined();
    const response = JSON.parse(rawNonexistent as string) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(7);
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Plugin not found');
    expect(response.error.message).toContain('nonexistent');
  });

  test('nonexistent tool in existing plugin sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'Send',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'nonexistent-tool', permission: 'auto' },
        id: 8,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawToolNotFound = ws.sent[0];
    expect(rawToolNotFound).toBeDefined();
    const response = JSON.parse(rawToolNotFound as string) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(8);
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Tool not found');
    expect(response.error.message).toContain('nonexistent-tool');
  });

  test('nonexistent plugin does not invoke callbacks', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onPluginPermissionsPersist: () => {
        configPersistCalled = true;
      },
      onPluginSettingsPersist: () => {},
      onPluginLog: () => {},
      onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
      queryExtension: () => Promise.resolve(undefined),
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'nonexistent', tool: 'send', permission: 'auto' },
        id: 9,
      }),
      callbacks,
    );

    expect(configChangedCalled).toBe(false);
    expect(configPersistCalled).toBe(false);
  });

  test('nonexistent tool does not mutate pluginPermissions', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'Send',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolPermission',
        params: { plugin: 'my-plugin', tool: 'nonexistent-tool', permission: 'auto' },
        id: 10,
      }),
      noopCallbacks,
    );

    expect(state.pluginPermissions).toEqual({});
  });
});

describe('handleExtensionMessage — config.setPluginPermission', () => {
  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    displayName: overrides.name,
    urlPatterns: [],
    excludePatterns: [],
    source: 'local' as const,
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('enabling all tools sets plugin-level permission to auto', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'alpha',
              displayName: 'Alpha',
              description: 'Alpha',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
            {
              name: 'beta',
              displayName: 'Beta',
              description: 'Beta',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
            {
              name: 'gamma',
              displayName: 'Gamma',
              description: 'Gamma',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );
    state.pluginPermissions = { 'my-plugin': { tools: { alpha: 'off', beta: 'off', gamma: 'off' } } };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setPluginPermission',
        params: { plugin: 'my-plugin', permission: 'auto' },
        id: 1,
      }),
      noopCallbacks,
    );

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('auto');

    // First message is plugins.changed notification, second is the result
    const rawAllEnabled = ws.sent[1];
    expect(rawAllEnabled).toBeDefined();
    const response = JSON.parse(rawAllEnabled as string) as { jsonrpc: string; id: number; result: { ok: boolean } };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ ok: true });
  });

  test('disabling all tools sets plugin-level permission to off', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'alpha',
              displayName: 'Alpha',
              description: 'Alpha',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
            {
              name: 'beta',
              displayName: 'Beta',
              description: 'Beta',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );
    state.pluginPermissions = { 'my-plugin': { tools: { alpha: 'auto', beta: 'auto' } } };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setPluginPermission',
        params: { plugin: 'my-plugin', permission: 'off' },
        id: 2,
      }),
      noopCallbacks,
    );

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('off');
  });

  test('both callbacks are invoked on valid request with existing plugin', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    state.registry = buildRegistry(
      [
        makePlugin({
          name: 'my-plugin',
          tools: [
            {
              name: 'alpha',
              displayName: 'Alpha',
              description: 'Alpha',
              icon: 'wrench',
              input_schema: {},
              output_schema: {},
            },
          ],
        }),
      ],
      [],
    );

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onPluginPermissionsPersist: () => {
        configPersistCalled = true;
      },
      onPluginSettingsPersist: () => {},
      onPluginLog: () => {},
      onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
      queryExtension: () => Promise.resolve(undefined),
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setPluginPermission',
        params: { plugin: 'my-plugin', permission: 'auto' },
        id: 3,
      }),
      callbacks,
    );

    expect(configChangedCalled).toBe(true);
    expect(configPersistCalled).toBe(true);
  });

  test('nonexistent plugin sends -32602 error without invoking callbacks', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onPluginPermissionsPersist: () => {
        configPersistCalled = true;
      },
      onPluginSettingsPersist: () => {},
      onPluginLog: () => {},
      onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
      queryExtension: () => Promise.resolve(undefined),
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setPluginPermission',
        params: { plugin: 'nonexistent', permission: 'auto' },
        id: 4,
      }),
      callbacks,
    );

    expect(configChangedCalled).toBe(false);
    expect(configPersistCalled).toBe(false);

    expect(ws.sent).toHaveLength(1);
    const rawAllNonexistent = ws.sent[0];
    expect(rawAllNonexistent).toBeDefined();
    const response = JSON.parse(rawAllNonexistent as string) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(4);
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Plugin not found');
    expect(response.error.message).toContain('nonexistent');
  });

  test('missing params sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', method: 'config.setPluginPermission', id: 5 }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawAllMissing = ws.sent[0];
    expect(rawAllMissing).toBeDefined();
    const response = JSON.parse(rawAllMissing as string) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(5);
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Missing params');
  });

  test('invalid param types sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setPluginPermission',
        params: { plugin: 'my-plugin', permission: 123 },
        id: 6,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawAllInvalid = ws.sent[0];
    expect(rawAllInvalid).toBeDefined();
    const response = JSON.parse(rawAllInvalid as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid params');
  });
});

describe('handleExtensionMessage — config.setSkipPermissions', () => {
  test('setting skipPermissions to false updates state and sends plugins.changed + ok result', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.skipPermissions = true;

    let configChangedCalled = false;
    const callbacks = {
      ...noopCallbacks,
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setSkipPermissions',
        params: { skipPermissions: false },
        id: 1,
      }),
      callbacks,
    );

    expect(state.skipPermissions).toBe(false);
    expect(configChangedCalled).toBe(true);

    // First message is plugins.changed notification
    expect(ws.sent.length).toBeGreaterThanOrEqual(2);
    const notification = JSON.parse(ws.sent[0] as string) as {
      method?: string;
      params?: { skipPermissions?: boolean };
    };
    expect(notification.method).toBe('plugins.changed');
    expect(notification.params?.skipPermissions).toBe(false);

    // Second message is the ok result
    const result = JSON.parse(ws.sent[1] as string) as { jsonrpc: string; id: number; result: { ok: boolean } };
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(1);
    expect(result.result).toEqual({ ok: true });
  });

  test('setting skipPermissions to true updates state', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.skipPermissions = false;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setSkipPermissions',
        params: { skipPermissions: true },
        id: 2,
      }),
      noopCallbacks,
    );

    expect(state.skipPermissions).toBe(true);
  });

  test('non-boolean skipPermissions sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setSkipPermissions',
        params: { skipPermissions: 'false' },
        id: 3,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const response = JSON.parse(ws.sent[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('skipPermissions must be a boolean');
  });

  test('missing params sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', method: 'config.setSkipPermissions', id: 4 }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const response = JSON.parse(ws.sent[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Missing params');
  });

  test('missing id is treated as unrecognized request (no crash)', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    // Without an id, the method falls through to the "unrecognized method with id" check,
    // but since id is undefined, it falls through to the final "unrecognized notification" branch.
    // Either way, the handler is not called and the server does not crash.
    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setSkipPermissions',
        params: { skipPermissions: false },
      }),
      noopCallbacks,
    );

    // No crash, and no ok result sent (since the handler requires id)
    expect(state.skipPermissions).toBe(false); // unchanged from default
  });
});

describe('dispatchToExtension — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('rejects with timeout error after DISPATCH_TIMEOUT_MS and removes pending entry', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    const rawTimeout = ws.sent[0];
    expect(rawTimeout).toBeDefined();
    const sent = parseJson(rawTimeout as string);
    const id = sent.id ?? -1;

    // Verify the pending dispatch exists before timeout
    expect(state.pendingDispatches.has(id)).toBe(true);

    // Advance time past the timeout
    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS);

    // The promise should reject with a timeout error containing the label and timeout duration
    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('timed out');
    expect((err as Error).message).toContain('slack/echo');
    expect((err as Error).message).toContain(`${DISPATCH_TIMEOUT_MS}ms`);

    // Verify the pending dispatch entry is removed
    expect(state.pendingDispatches.has(id)).toBe(false);
  });

  test('timeout error includes method name when no label provided', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(state, 'browser.openTab', { url: 'https://example.com' });

    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS);

    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('browser.openTab');
    expect((err as Error).message).toContain('timed out');
  });
});

describe('handleToolProgress — timeout reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('dispatch without progress times out at DISPATCH_TIMEOUT_MS', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'test', tool: 'slow' },
      { label: 'test/slow', onProgress: () => {} },
    );

    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS);

    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('timed out');
    expect((err as Error).message).toContain(`${DISPATCH_TIMEOUT_MS}ms`);
  });

  test('progress resets the timeout — dispatch survives past DISPATCH_TIMEOUT_MS', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let progressCalls = 0;
    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'test', tool: 'slow' },
      {
        label: 'test/slow',
        onProgress: () => {
          progressCalls++;
        },
      },
    );

    // Extract the __opentabs_dispatchId from the sent message
    const rawMsg = ws.sent[0];
    expect(rawMsg).toBeDefined();
    const sentMsg = JSON.parse(rawMsg as string) as { id: string; params: { __opentabs_dispatchId: string } };
    const dispatchId = sentMsg.params.__opentabs_dispatchId;

    // Advance 20s (before 30s timeout) and send a progress notification
    vi.advanceTimersByTime(20_000);
    expect(state.pendingDispatches.has(dispatchId)).toBe(true);

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tool.progress',
        params: { dispatchId, progress: 1, total: 3, message: 'Step 1' },
      }),
      noopCallbacks,
    );
    expect(progressCalls).toBe(1);

    // Advance another 20s (total 40s — past original 30s timeout).
    // The dispatch should still be alive because progress reset the timer.
    vi.advanceTimersByTime(20_000);
    expect(state.pendingDispatches.has(dispatchId)).toBe(true);

    // Send another progress at 40s
    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tool.progress',
        params: { dispatchId, progress: 2, total: 3 },
      }),
      noopCallbacks,
    );
    expect(progressCalls).toBe(2);

    // Resolve the dispatch to clean up
    const pending = state.pendingDispatches.get(dispatchId);
    expect(pending).toBeDefined();
    const settledPending = pending as PendingDispatch;
    clearTimeout(settledPending.timerId);
    settledPending.resolve({ output: 'done' });

    const result = await promise;
    expect(result).toEqual({ output: 'done' });
  });

  test('progress updates lastProgressTs on PendingDispatch', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    void dispatchToExtension(state, 'tool.dispatch', { plugin: 'test', tool: 'slow' }, { label: 'test/slow' });

    const rawMsg = ws.sent[0];
    expect(rawMsg).toBeDefined();
    const sentMsg = JSON.parse(rawMsg as string) as { params: { __opentabs_dispatchId: string } };
    const dispatchId = sentMsg.params.__opentabs_dispatchId;

    const pending = state.pendingDispatches.get(dispatchId);
    expect(pending).toBeDefined();
    const checkedPending = pending as PendingDispatch;
    expect(checkedPending.lastProgressTs).toBeUndefined();

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tool.progress',
        params: { dispatchId, progress: 1, total: 5 },
      }),
      noopCallbacks,
    );

    expect(checkedPending.lastProgressTs).toBeDefined();
    expect(typeof checkedPending.lastProgressTs).toBe('number');

    // Clean up
    clearTimeout(checkedPending.timerId);
    checkedPending.resolve('cleanup');
  });

  test('absolute max timeout fires even with continuous progress', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'test', tool: 'forever' },
      { label: 'test/forever', onProgress: () => {} },
    );

    const rawMsg = ws.sent[0];
    expect(rawMsg).toBeDefined();
    const sentMsg = JSON.parse(rawMsg as string) as { params: { __opentabs_dispatchId: string } };
    const dispatchId = sentMsg.params.__opentabs_dispatchId;

    // Send progress every 20s to keep resetting the timeout.
    // MAX_DISPATCH_TIMEOUT_MS is 300_000 (5 minutes).
    // After 280s, send progress — remaining max = 20s, next timeout = min(30s, 20s) = 20s.
    for (let elapsed = 0; elapsed < MAX_DISPATCH_TIMEOUT_MS - DISPATCH_TIMEOUT_MS; elapsed += 20_000) {
      vi.advanceTimersByTime(20_000);
      if (!state.pendingDispatches.has(dispatchId)) break;
      handleExtensionMessage(
        state,
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'tool.progress',
          params: { dispatchId, progress: elapsed / 20_000, total: 100 },
        }),
        noopCallbacks,
      );
    }

    // The dispatch should still be alive right before the absolute max
    expect(state.pendingDispatches.has(dispatchId)).toBe(true);

    // Advance past the absolute max timeout — the next progress or timeout fires rejection
    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS + 1_000);

    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('timed out');
    expect(state.pendingDispatches.has(dispatchId)).toBe(false);
  });

  test('progress after absolute max elapsed rejects immediately', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'test', tool: 'forever' },
      { label: 'test/forever', onProgress: () => {} },
    );

    const rawMsg = ws.sent[0];
    expect(rawMsg).toBeDefined();
    const sentMsg = JSON.parse(rawMsg as string) as { params: { __opentabs_dispatchId: string } };
    const dispatchId = sentMsg.params.__opentabs_dispatchId;

    // Manually set startTs to simulate a dispatch that has been running for MAX_DISPATCH_TIMEOUT_MS
    const pending = state.pendingDispatches.get(dispatchId);
    expect(pending).toBeDefined();
    (pending as PendingDispatch).startTs = Date.now() - MAX_DISPATCH_TIMEOUT_MS - 1;

    // Send progress — this should trigger immediate rejection because the absolute max is exceeded
    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tool.progress',
        params: { dispatchId, progress: 1, total: 10 },
      }),
      noopCallbacks,
    );

    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('absolute max timeout');
    expect((err as Error).message).toContain(`${MAX_DISPATCH_TIMEOUT_MS}ms`);
    expect(state.pendingDispatches.has(dispatchId)).toBe(false);
  });
});

describe('writeAdapterFile', () => {
  let tmpDir: string;
  let adaptersDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(async () => {
    originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-writeadapter-'));
    process.env.OPENTABS_CONFIG_DIR = tmpDir;
    adaptersDir = join(tmpDir, 'extension', 'adapters');
    await mkdir(adaptersDir, { recursive: true });
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates the final file with correct content and returns hashed path', async () => {
    const content = '(function(){ console.log("adapter"); })()';
    const adapterFile = await writeAdapterFile('my-plugin', content);

    expect(adapterFile).toMatch(/^adapters\/my-plugin-[0-9a-f]{8}\.js$/);

    const fileName = adapterFile.replace('adapters/', '');
    const written = await readFile(join(adaptersDir, fileName), 'utf-8');
    expect(written).toBe(content);
  });

  test('.tmp file does not exist after successful write (rename completed)', async () => {
    const adapterFile = await writeAdapterFile('my-plugin', '// adapter code');
    const baseName = adapterFile.replace('adapters/', '').replace('.js', '');

    const tmpPath = join(adaptersDir, `${baseName}.js.tmp`);
    expect(existsSync(tmpPath)).toBe(false);

    // Final file exists
    const finalPath = join(adaptersDir, `${baseName}.js`);
    expect(existsSync(finalPath)).toBe(true);
  });

  test('overwrite replaces existing file content with new hashed file', async () => {
    const path1 = await writeAdapterFile('my-plugin', '// version 1');
    const path2 = await writeAdapterFile('my-plugin', '// version 2');

    // Different content → different hash → different path
    expect(path2).not.toBe(path1);

    const entries = await readdir(adaptersDir);
    const myPluginFiles = entries.filter(f => f.startsWith('my-plugin-') && f.endsWith('.js'));
    // Old file cleaned up, only the new one remains
    expect(myPluginFiles).toHaveLength(1);

    const latestFile = myPluginFiles[0];
    expect(latestFile).toBeDefined();
    if (!latestFile) return; // Unreachable after expect, satisfies TypeScript
    const content = await readFile(join(adaptersDir, latestFile), 'utf-8');
    expect(content).toBe('// version 2');
  });

  test('concurrent writes to different plugin names do not interfere', async () => {
    const writes = [
      writeAdapterFile('plugin-a', '// adapter A'),
      writeAdapterFile('plugin-b', '// adapter B'),
      writeAdapterFile('plugin-c', '// adapter C'),
    ];
    const paths = await Promise.all(writes);

    for (const p of paths) {
      const fileName = p.replace('adapters/', '');
      expect(existsSync(join(adaptersDir, fileName))).toBe(true);
    }

    const [pathA, pathB, pathC] = paths;
    expect(pathA).toBeDefined();
    expect(pathB).toBeDefined();
    expect(pathC).toBeDefined();
    if (!pathA || !pathB || !pathC) return; // Unreachable after expect, satisfies TypeScript
    const contentA = await readFile(join(adaptersDir, pathA.replace('adapters/', '')), 'utf-8');
    const contentB = await readFile(join(adaptersDir, pathB.replace('adapters/', '')), 'utf-8');
    const contentC = await readFile(join(adaptersDir, pathC.replace('adapters/', '')), 'utf-8');

    expect(contentA).toBe('// adapter A');
    expect(contentB).toBe('// adapter B');
    expect(contentC).toBe('// adapter C');

    // No .tmp files left behind
    const entries = await readdir(adaptersDir);
    const tmpFiles = entries.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toEqual([]);
  });

  test('writes large IIFE content correctly', async () => {
    const largeContent = `// ${'x'.repeat(100_000)}`;
    const adapterFile = await writeAdapterFile('large-plugin', largeContent);

    const fileName = adapterFile.replace('adapters/', '');
    const written = await readFile(join(adaptersDir, fileName), 'utf-8');
    expect(written).toBe(largeContent);
  });
});

describe('queryExtension', () => {
  test('sends a request and resolves with the response result', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const resultPromise = queryExtension(state, 'extension.getTabState', {}, 5000);

    // Extract the id from the sent message
    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0] ?? '{}') as { id: string; method: string };
    expect(sent.method).toBe('extension.getTabState');

    // Simulate the extension responding
    const responseResult = { tabStates: { slack: { state: 'ready', tabs: [] } } };
    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', result: responseResult, id: sent.id }),
      noopCallbacks,
    );

    const result = await resultPromise;
    expect(result).toEqual(responseResult);
  });

  test('rejects when extension is not connected', async () => {
    const state = createState();

    await expect(queryExtension(state, 'extension.getTabState')).rejects.toThrow();
  });
});

describe('sendConfirmationRequest', () => {
  test('sends confirmation.request with new payload shape and stores pending confirmation', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = sendConfirmationRequest(state, 'send_message', 'slack', { channel: '#general', text: 'hi' });

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0] as string) as {
      jsonrpc: string;
      method: string;
      params: { id: string; tool: string; plugin: string; params: Record<string, unknown> };
    };

    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('confirmation.request');
    expect(typeof msg.params.id).toBe('string');
    expect(msg.params.tool).toBe('send_message');
    expect(msg.params.plugin).toBe('slack');
    expect(msg.params.params).toEqual({ channel: '#general', text: 'hi' });

    // No domain, tabId, paramsPreview, or timeoutMs fields
    const rawParams = msg.params as Record<string, unknown>;
    expect('domain' in rawParams).toBe(false);
    expect('tabId' in rawParams).toBe(false);
    expect('paramsPreview' in rawParams).toBe(false);
    expect('timeoutMs' in rawParams).toBe(false);

    // Pending confirmation stored
    expect(state.pendingConfirmations.size).toBe(1);
    const pendingId = msg.params.id;
    const pending = state.pendingConfirmations.get(pendingId);
    expect(pending).toBeDefined();
    expect(pending?.tool).toBe('send_message');
    expect(pending?.plugin).toBe('slack');

    // Clean up by resolving the promise
    pending?.resolve({ action: 'allow', alwaysAllow: false });
    return promise;
  });

  test('resolves with ConfirmationDecision when user responds via confirmation.response', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = sendConfirmationRequest(state, 'browser_click', 'browser', { selector: '#btn' });

    // Extract the confirmation id from the sent message
    const msg = JSON.parse(ws.sent[0] as string) as { params: { id: string } };
    const id = msg.params.id;

    // Simulate the extension sending a confirmation response
    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id, decision: 'allow', alwaysAllow: true },
      }),
      noopCallbacks,
    );

    const decision: ConfirmationDecision = await promise;
    expect(decision.action).toBe('allow');
    expect(decision.alwaysAllow).toBe(true);
    expect(state.pendingConfirmations.size).toBe(0);
  });

  test('resolves with deny when user denies', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = sendConfirmationRequest(state, 'delete_message', 'slack', {});

    const msg = JSON.parse(ws.sent[0] as string) as { params: { id: string } };
    const id = msg.params.id;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id, decision: 'deny' },
      }),
      noopCallbacks,
    );

    const decision: ConfirmationDecision = await promise;
    expect(decision.action).toBe('deny');
    expect(decision.alwaysAllow).toBe(false);
  });

  test('rejects when extension is not connected', async () => {
    const state = createState();

    await expect(sendConfirmationRequest(state, 'test_tool', 'test', {})).rejects.toThrow('Extension not connected');
    expect(state.pendingConfirmations.size).toBe(0);
  });

  test('hangs indefinitely until resolved (no timeout)', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise = sendConfirmationRequest(state, 'slow_tool', 'plugin', {});

    // The promise is pending with no timeout — the pending confirmation stays in the map
    expect(state.pendingConfirmations.size).toBe(1);

    // Verify no timerId on the pending confirmation (simplified PendingConfirmation has no timerId)
    const pendingEntry = [...state.pendingConfirmations.values()][0];
    expect(pendingEntry).toBeDefined();
    expect('timerId' in (pendingEntry as unknown as Record<string, unknown>)).toBe(false);

    // Clean up by resolving
    pendingEntry?.resolve({ action: 'allow', alwaysAllow: false });
    await promise;
  });
});

describe('rejectAllPendingConfirmations', () => {
  test('rejects all pending confirmations and clears the map', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    const promise1 = sendConfirmationRequest(state, 'tool_a', 'plugin_a', {});
    const promise2 = sendConfirmationRequest(state, 'tool_b', 'plugin_b', {});

    expect(state.pendingConfirmations.size).toBe(2);

    rejectAllPendingConfirmations(state);

    expect(state.pendingConfirmations.size).toBe(0);

    await expect(promise1).rejects.toThrow('Extension disconnected');
    await expect(promise2).rejects.toThrow('Extension disconnected');
  });

  test('handles empty pendingConfirmations gracefully', () => {
    const state = createState();

    rejectAllPendingConfirmations(state);

    expect(state.pendingConfirmations.size).toBe(0);
  });
});

describe('handleExtensionMessage — confirmation.response routing', () => {
  test('routes confirmation.response to handleConfirmationResponse', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let resolved: ConfirmationDecision | undefined;
    state.pendingConfirmations.set('test-id', {
      resolve: (decision: ConfirmationDecision) => {
        resolved = decision;
      },
      reject: () => {},
      tool: 'test_tool',
      plugin: 'test_plugin',
      params: {},
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id: 'test-id', decision: 'allow', alwaysAllow: true },
      }),
      noopCallbacks,
    );

    expect(resolved).toEqual({ action: 'allow', alwaysAllow: true });
    expect(state.pendingConfirmations.size).toBe(0);
  });

  test('ignores confirmation.response with unknown id', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let resolved = false;
    state.pendingConfirmations.set('known-id', {
      resolve: () => {
        resolved = true;
      },
      reject: () => {},
      tool: 'tool',
      plugin: 'plugin',
      params: {},
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id: 'unknown-id', decision: 'allow' },
      }),
      noopCallbacks,
    );

    expect(resolved).toBe(false);
    expect(state.pendingConfirmations.size).toBe(1);
  });

  test('ignores confirmation.response with invalid decision', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let resolved = false;
    state.pendingConfirmations.set('conf-id', {
      resolve: () => {
        resolved = true;
      },
      reject: () => {},
      tool: 'tool',
      plugin: 'plugin',
      params: {},
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id: 'conf-id', decision: 'invalid' },
      }),
      noopCallbacks,
    );

    expect(resolved).toBe(false);
    expect(state.pendingConfirmations.size).toBe(1);
  });

  test('defaults alwaysAllow to false when not provided', () => {
    const state = createState();
    state.extensionConnections.set('test-conn', {
      ws: createMockWs(),
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    let resolved: ConfirmationDecision | undefined;
    state.pendingConfirmations.set('conf-no-always', {
      resolve: (decision: ConfirmationDecision) => {
        resolved = decision;
      },
      reject: () => {},
      tool: 'tool',
      plugin: 'plugin',
      params: {},
    });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'confirmation.response',
        params: { id: 'conf-no-always', decision: 'allow' },
      }),
      noopCallbacks,
    );

    expect(resolved).toEqual({ action: 'allow', alwaysAllow: false });
  });
});

/** Helper to create a mock connection with a trackable WsHandle */
const createMockConnection = (id: string): { conn: ExtensionConnection; ws: WsHandle & { sent: string[] } } => {
  const ws = createMockWs();
  const conn: ExtensionConnection = {
    ws,
    connectionId: id,
    profileLabel: id,
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  };
  return { conn, ws };
};

describe('multi-connection — dispatch routing', () => {
  test('dispatchToExtension routes to the connection owning the target tabId', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // Dispatch targeting tab 20 (owned by connB)
    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send', tabId: 20 },
      'slack/send',
    );

    // Only connB's ws should receive the dispatch
    expect(wsB.sent).toHaveLength(1);
    expect(wsA.sent).toHaveLength(0);

    // Settle to prevent timeout leak
    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('dispatchToExtension falls back to any connection when tabId matches no connection', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', connA);

    // Dispatch targeting a tabId that no connection owns
    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send', tabId: 999 },
      'slack/send',
    );

    // Should fall back to the only available connection
    expect(wsA.sent).toHaveLength(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('dispatchToExtension uses first connection when no tabId is provided', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    // Should send to one of the connections (first in map iteration order)
    const totalSent = wsA.sent.length + wsB.sent.length;
    expect(totalSent).toBe(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('dispatchToExtension stores connectionId on PendingDispatch', () => {
    const state = createState();
    const { conn } = createMockConnection('conn-alpha');
    state.extensionConnections.set('conn-alpha', conn);

    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    const pending = [...state.pendingDispatches.values()][0];
    expect(pending?.connectionId).toBe('conn-alpha');

    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });
});

describe('multi-connection — sendSyncFull broadcasts to all', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-test-'));
    process.env.OPENTABS_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('sendSyncFull sends to both connections', async () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    await sendSyncFull(state);

    expect(wsA.sent.length).toBeGreaterThanOrEqual(1);
    expect(wsB.sent.length).toBeGreaterThanOrEqual(1);
    // Both connections should receive the same sync.full message
    const msgA = JSON.parse(wsA.sent[0] as string) as { method?: string };
    const msgB = JSON.parse(wsB.sent[0] as string) as { method?: string };
    expect(msgA.method).toBe('sync.full');
    expect(msgB.method).toBe('sync.full');
  });
});

describe('multi-connection — sendConfirmationRequest broadcasts to all', () => {
  test('confirmation request is broadcast to both connections', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = sendConfirmationRequest(state, 'slack_send_message', 'slack', { text: 'hi' });

    // Both connections should receive the confirmation.request
    expect(wsA.sent.length).toBeGreaterThanOrEqual(1);
    expect(wsB.sent.length).toBeGreaterThanOrEqual(1);

    const msgA = JSON.parse(wsA.sent[wsA.sent.length - 1] as string) as { method?: string };
    expect(msgA.method).toBe('confirmation.request');

    // Settle to prevent timeout leak
    const [, pending] = [...state.pendingConfirmations.entries()][0] ?? [];
    pending?.resolve({ action: 'allow', alwaysAllow: false });
    return promise;
  });
});

describe('multi-connection — resolveConnection with connectionId', () => {
  test('connectionId takes priority over tabId when both are present', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    // Tab 10 is owned by connA
    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // Pass tabId pointing to connA but connectionId pointing to connB
    const promise = dispatchToExtension(state, 'tool.dispatch', {
      plugin: 'slack',
      tool: 'send',
      tabId: 10,
      connectionId: 'conn-b',
    });

    // connectionId should win — connB receives the dispatch
    expect(wsB.sent).toHaveLength(1);
    expect(wsA.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('connectionId routes to the matching connection', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(state, 'tool.dispatch', {
      plugin: 'slack',
      connectionId: 'conn-b',
    });

    expect(wsB.sent).toHaveLength(1);
    expect(wsA.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('unknown connectionId falls back to tabId routing', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(state, 'tool.dispatch', {
      plugin: 'slack',
      connectionId: 'nonexistent',
      tabId: 20,
    });

    // connectionId not found → falls through to tabId → connB
    expect(wsB.sent).toHaveLength(1);
    expect(wsA.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('unknown connectionId and no tabId falls back to getAnyConnection', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(state, 'tool.dispatch', {
      plugin: 'slack',
      connectionId: 'nonexistent',
    });

    // Falls back to any connection (first in map iteration = conn-a)
    const totalSent = wsA.sent.length + wsB.sent.length;
    expect(totalSent).toBe(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('single connection bypasses connectionId check', () => {
    const state = createState();
    const { conn, ws } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);

    // Even with a different connectionId, single-connection shortcut returns the only one
    const promise = dispatchToExtension(state, 'tool.dispatch', {
      plugin: 'slack',
      connectionId: 'different-id',
    });

    expect(ws.sent).toHaveLength(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });
});

describe('dispatchToAllConnections', () => {
  test('rejects when no connections exist', async () => {
    const state = createState();

    await expect(dispatchToAllConnections(state, 'browser.listTabs', {})).rejects.toThrow('Extension not connected');
  });

  test('dispatches to all connections and collects results', async () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToAllConnections(state, 'browser.listTabs', {});

    // Both connections should receive the dispatch
    expect(wsA.sent).toHaveLength(1);
    expect(wsB.sent).toHaveLength(1);

    // Extract dispatch IDs and settle them
    const msgA = JSON.parse(wsA.sent[0] as string) as { id: string };
    const msgB = JSON.parse(wsB.sent[0] as string) as { id: string };

    const pendingA = state.pendingDispatches.get(msgA.id);
    const pendingB = state.pendingDispatches.get(msgB.id);
    pendingA?.resolve([{ id: 1, title: 'Tab A' }]);
    pendingB?.resolve([{ id: 2, title: 'Tab B' }]);
    if (pendingA) clearTimeout(pendingA.timerId);
    if (pendingB) clearTimeout(pendingB.timerId);

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        { connectionId: 'conn-a', result: [{ id: 1, title: 'Tab A' }] },
        { connectionId: 'conn-b', result: [{ id: 2, title: 'Tab B' }] },
      ]),
    );
  });

  test('handles partial failures — successful connection results are returned', async () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToAllConnections(state, 'browser.listTabs', {});

    const msgA = JSON.parse(wsA.sent[0] as string) as { id: string };
    const msgB = JSON.parse(wsB.sent[0] as string) as { id: string };

    const pendingA = state.pendingDispatches.get(msgA.id);
    const pendingB = state.pendingDispatches.get(msgB.id);

    // connA succeeds, connB fails
    pendingA?.resolve([{ id: 1, title: 'Tab A' }]);
    pendingB?.reject(new Error('Connection lost'));
    if (pendingA) clearTimeout(pendingA.timerId);
    if (pendingB) clearTimeout(pendingB.timerId);

    const results = await promise;
    // Only connA's results should be returned
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ connectionId: 'conn-a', result: [{ id: 1, title: 'Tab A' }] });
  });

  test('single connection dispatch works correctly', async () => {
    const state = createState();
    const { conn, ws } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);

    const promise = dispatchToAllConnections(state, 'browser.listTabs', {});

    expect(ws.sent).toHaveLength(1);

    const msg = JSON.parse(ws.sent[0] as string) as { id: string };
    const pending = state.pendingDispatches.get(msg.id);
    pending?.resolve([{ id: 1, title: 'Tab' }]);
    if (pending) clearTimeout(pending.timerId);

    const results = await promise;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ connectionId: 'conn-a', result: [{ id: 1, title: 'Tab' }] });
  });

  test('injects __opentabs_dispatchId into sent params', async () => {
    const state = createState();
    const { conn, ws } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);

    const promise = dispatchToAllConnections(state, 'browser.listTabs', { extra: 'data' });

    const msg = JSON.parse(ws.sent[0] as string) as { id: string; params: Record<string, unknown> };
    expect(msg.params.__opentabs_dispatchId).toBe(msg.id);
    expect(msg.params.extra).toBe('data');

    const pending = state.pendingDispatches.get(msg.id);
    pending?.resolve([]);
    if (pending) clearTimeout(pending.timerId);

    await promise;
  });
});

describe('multi-connection — plugin-aware dispatch routing', () => {
  test('with pluginName set, picks the connection whose tabMapping has the plugin in ready state', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    connA.tabMapping.set('github', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://github.com', title: 'GitHub', ready: true }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send' },
      { label: 'slack/send', pluginName: 'slack' },
    );

    // connB has slack in 'ready' — should receive the dispatch
    expect(wsB.sent).toHaveLength(1);
    expect(wsA.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('with pluginName set, prefers unavailable over no mapping', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    connA.tabMapping.set('slack', {
      state: 'unavailable',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: false }],
    });
    // connB has no slack mapping at all
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send' },
      { label: 'slack/send', pluginName: 'slack' },
    );

    // connA has slack in 'unavailable' — preferred over connB with no mapping
    expect(wsA.sent).toHaveLength(1);
    expect(wsB.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('with pluginName set but no connection has the plugin, falls back to getAnyConnection', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'unknown', tool: 'echo' },
      { label: 'unknown/echo', pluginName: 'unknown' },
    );

    // No connection has 'unknown' in tabMapping — falls back to getAnyConnection (first in Map)
    const totalSent = wsA.sent.length + wsB.sent.length;
    expect(totalSent).toBe(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('single connection — pluginName is ignored, fast path returns the only connection', () => {
    const state = createState();
    const { conn, ws } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);

    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send' },
      { label: 'slack/send', pluginName: 'slack' },
    );

    expect(ws.sent).toHaveLength(1);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });

  test('pluginName + tabId both set — tabId takes priority', () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    // connA owns tab 10
    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    // connB has github ready
    connB.tabMapping.set('github', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://github.com', title: 'GitHub', ready: true }],
    });
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // pluginName points to github (connB), but tabId 10 belongs to connA
    const promise = dispatchToExtension(
      state,
      'tool.dispatch',
      { plugin: 'slack', tool: 'send', tabId: 10 },
      { label: 'slack/send', pluginName: 'github' },
    );

    // tabId routing takes priority — connA receives the dispatch
    expect(wsA.sent).toHaveLength(1);
    expect(wsB.sent).toHaveLength(0);

    const pending = [...state.pendingDispatches.values()][0];
    pending?.resolve('ok');
    if (pending) clearTimeout(pending.timerId);
    return promise;
  });
});
