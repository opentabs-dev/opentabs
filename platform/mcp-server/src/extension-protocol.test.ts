import {
  dispatchToExtension,
  handleExtensionMessage,
  isDispatchError,
  sendSyncFull,
  writeAdapterFile,
} from './extension-protocol.js';
import { createState, DISPATCH_TIMEOUT_MS } from './state.js';
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PendingDispatch, RegisteredPlugin } from './state.js';
import type { WsHandle } from '@opentabs-dev/shared';

/** Create a mock WsHandle that records sent messages */
const createMockWs = (): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {},
});

/** No-op MCP callbacks for tests that don't exercise config changes */
const noopCallbacks = { onToolConfigChanged: () => {}, onToolConfigPersist: () => {} };

/** Type-safe JSON parse returning a typed record */
const parseJson = (
  text: string,
): { jsonrpc?: string; method?: string; id?: number; error?: { code: number; message: string } } =>
  JSON.parse(text) as { jsonrpc?: string; method?: string; id?: number; error?: { code: number; message: string } };

describe('handleExtensionMessage — ping', () => {
  test('ping replies with pong on the sender ws, not state.extensionWs', () => {
    const state = createState();
    const extensionWs = createMockWs();
    const senderWs = createMockWs();
    state.extensionWs = extensionWs;

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'ping' }), noopCallbacks, senderWs);

    expect(senderWs.sent).toHaveLength(1);
    const raw = senderWs.sent[0];
    expect(raw).toBeDefined();
    expect(parseJson(raw as string)).toEqual({ jsonrpc: '2.0', method: 'pong' });
    expect(extensionWs.sent).toHaveLength(0);
  });

  test('ping falls back to state.extensionWs when no senderWs provided', () => {
    const state = createState();
    const extensionWs = createMockWs();
    state.extensionWs = extensionWs;

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
    state.extensionWs = createMockWs();

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
    state.extensionWs = createMockWs();

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
    state.extensionWs = createMockWs();

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

  test('error response without data field has undefined data', () => {
    const state = createState();
    state.extensionWs = createMockWs();

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
    state.extensionWs = createMockWs();

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
  test('updates state.tabMapping with all entries', () => {
    const state = createState();
    state.extensionWs = createMockWs();

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.syncAll',
        params: {
          tabs: {
            slack: { state: 'ready', tabId: 10, url: 'https://app.slack.com' },
            github: { state: 'unavailable', tabId: 20, url: 'https://github.com' },
          },
        },
      }),
      noopCallbacks,
    );

    expect(state.tabMapping.size).toBe(2);
    expect(state.tabMapping.get('slack')).toEqual({ state: 'ready', tabId: 10, url: 'https://app.slack.com' });
    expect(state.tabMapping.get('github')).toEqual({ state: 'unavailable', tabId: 20, url: 'https://github.com' });
  });

  test('clears previous tabMapping entries on sync', () => {
    const state = createState();
    state.extensionWs = createMockWs();
    state.tabMapping.set('old-plugin', { state: 'ready', tabId: 1, url: 'https://old.com' });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.syncAll',
        params: {
          tabs: { slack: { state: 'closed' } },
        },
      }),
      noopCallbacks,
    );

    expect(state.tabMapping.size).toBe(1);
    expect(state.tabMapping.has('old-plugin')).toBe(false);
    expect(state.tabMapping.get('slack')).toEqual({ state: 'closed', tabId: null, url: null });
  });
});

describe('handleExtensionMessage — tab.stateChanged', () => {
  test('updates a single entry in state.tabMapping', () => {
    const state = createState();
    state.extensionWs = createMockWs();

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: { plugin: 'slack', state: 'ready', tabId: 5, url: 'https://app.slack.com' },
      }),
      noopCallbacks,
    );

    expect(state.tabMapping.size).toBe(1);
    expect(state.tabMapping.get('slack')).toEqual({ state: 'ready', tabId: 5, url: 'https://app.slack.com' });
  });

  test('does not affect other entries in tabMapping', () => {
    const state = createState();
    state.extensionWs = createMockWs();
    state.tabMapping.set('github', { state: 'ready', tabId: 10, url: 'https://github.com' });

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tab.stateChanged',
        params: { plugin: 'slack', state: 'closed' },
      }),
      noopCallbacks,
    );

    expect(state.tabMapping.size).toBe(2);
    expect(state.tabMapping.get('github')).toEqual({ state: 'ready', tabId: 10, url: 'https://github.com' });
    expect(state.tabMapping.get('slack')).toEqual({ state: 'closed', tabId: null, url: null });
  });
});

describe('handleExtensionMessage — unrecognized method', () => {
  test('unrecognized method with id sends -32601 error response', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

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

describe('handleExtensionMessage — oversized message', () => {
  test('oversized message is dropped without state changes', () => {
    const state = createState();
    state.extensionWs = createMockWs();

    // Create a message larger than 10MB
    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);

    handleExtensionMessage(state, oversized, noopCallbacks);

    expect(state.tabMapping.size).toBe(0);
    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('handleExtensionMessage — malformed JSON', () => {
  test('malformed JSON is dropped gracefully', () => {
    const state = createState();
    state.extensionWs = createMockWs();

    handleExtensionMessage(state, 'not valid json{{{', noopCallbacks);

    expect(state.tabMapping.size).toBe(0);
    expect(state.pendingDispatches.size).toBe(0);
  });
});

describe('sendSyncFull', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      Bun.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete Bun.env.OPENTABS_CONFIG_DIR;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const setupTmpConfigDir = (): void => {
    originalConfigDir = Bun.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-test-'));
    Bun.env.OPENTABS_CONFIG_DIR = tmpDir;
  };

  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    urlPatterns: [],
    trustTier: 'community',
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('sends sync.full with correct plugin metadata and tool enabled state', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'alpha',
      makePlugin({
        name: 'alpha',
        version: '1.0.0',
        urlPatterns: ['http://alpha.com/*'],
        trustTier: 'community',
        iife: '// alpha iife',
        tools: [{ name: 'ping', description: 'Ping', input_schema: {}, output_schema: {} }],
      }),
    );
    state.plugins.set(
      'beta',
      makePlugin({
        name: 'beta',
        version: '2.0.0',
        urlPatterns: ['http://beta.com/*'],
        trustTier: 'local',
        iife: '// beta iife',
        tools: [{ name: 'pong', description: 'Pong', input_schema: {}, output_schema: {} }],
      }),
    );

    // alpha_ping enabled (default), beta_pong explicitly disabled
    state.toolConfig = { beta_pong: false };

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
          trustTier: string;
          displayName: string | undefined;
          sourcePath: string | undefined;
          adapterHash: string | undefined;
          tools: { name: string; description: string; enabled: boolean }[];
        }[];
      };
    };

    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('sync.full');
    expect(msg.params.plugins).toHaveLength(2);

    // Sort by name for deterministic assertions (Map iteration order matches insertion order,
    // but sorting makes the test resilient to refactoring)
    const sorted = [...msg.params.plugins].sort((a, b) => a.name.localeCompare(b.name));

    const firstPlugin = sorted[0];
    expect(firstPlugin).toBeDefined();
    expect(firstPlugin).toEqual({
      name: 'alpha',
      version: '1.0.0',
      urlPatterns: ['http://alpha.com/*'],
      trustTier: 'community',
      displayName: undefined,
      sourcePath: undefined,
      adapterHash: undefined,
      tools: [{ name: 'ping', description: 'Ping', enabled: true }],
    });

    const secondPlugin = sorted[1];
    expect(secondPlugin).toBeDefined();
    expect(secondPlugin).toEqual({
      name: 'beta',
      version: '2.0.0',
      urlPatterns: ['http://beta.com/*'],
      trustTier: 'local',
      displayName: undefined,
      sourcePath: undefined,
      adapterHash: undefined,
      tools: [{ name: 'pong', description: 'Pong', enabled: false }],
    });
  });

  test('writes adapter IIFE files to the adapters directory', async () => {
    setupTmpConfigDir();
    const state = createState();
    state.extensionWs = createMockWs();

    state.plugins.set(
      'test-plugin',
      makePlugin({
        name: 'test-plugin',
        iife: '(function(){/* adapter */})()',
        tools: [{ name: 'echo', description: 'Echo', input_schema: {}, output_schema: {} }],
      }),
    );

    await sendSyncFull(state);

    const adapterPath = join(tmpDir, 'extension', 'adapters', 'test-plugin.js');
    const content = await Bun.file(adapterPath).text();
    expect(content).toBe('(function(){/* adapter */})()');
  });

  test('sends sync.full even when extensionWs is null (message is silently dropped)', async () => {
    setupTmpConfigDir();
    const state = createState();
    state.extensionWs = null;

    state.plugins.set('alpha', makePlugin({ name: 'alpha', iife: '// alpha' }));

    // Should not throw
    await sendSyncFull(state);

    // Adapter file is still written
    const adapterPath = join(tmpDir, 'extension', 'adapters', 'alpha.js');
    const content = await Bun.file(adapterPath).text();
    expect(content).toBe('// alpha');
  });

  test('sends empty plugins array when no plugins are registered', async () => {
    setupTmpConfigDir();
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    await sendSyncFull(state);

    expect(ws.sent).toHaveLength(1);
    const rawEmpty = ws.sent[0];
    expect(rawEmpty).toBeDefined();
    const msg = JSON.parse(rawEmpty as string) as { params: { plugins: unknown[] } };
    expect(msg.params.plugins).toEqual([]);
  });
});

describe('dispatchToExtension', () => {
  test('rejects immediately when extensionWs is null', () => {
    const state = createState();

    expect(dispatchToExtension(state, 'tool.dispatch', { tool: 'test' })).rejects.toThrow('Extension not connected');
  });

  test('sends JSON-RPC request and creates a pending dispatch entry', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

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

  test('dispatch can be settled by handleExtensionMessage response', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

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
    urlPatterns: [],
    trustTier: 'community',
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('returns plugins with displayName, version, trustTier, tabState, urlPatterns, and tools', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'test-plugin',
      makePlugin({
        name: 'test-plugin',
        displayName: 'Test Plugin',
        version: '2.1.0',
        trustTier: 'local',
        urlPatterns: ['http://test.com/*'],
        tools: [
          { name: 'ping', description: 'Ping tool', input_schema: {}, output_schema: {} },
          { name: 'pong', description: 'Pong tool', input_schema: {}, output_schema: {} },
        ],
      }),
    );
    state.tabMapping.set('test-plugin', { state: 'ready', tabId: 10, url: 'http://test.com' });

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
          trustTier: string;
          tabState: string;
          urlPatterns: string[];
          tools: { name: string; description: string; enabled: boolean }[];
        }[];
        outdatedPlugins: unknown[];
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
    expect(plugin.trustTier).toBe('local');
    expect(plugin.tabState).toBe('ready');
    expect(plugin.urlPatterns).toEqual(['http://test.com/*']);
    expect(plugin.tools).toHaveLength(2);
    const pingTool = plugin.tools[0];
    expect(pingTool).toBeDefined();
    expect(pingTool).toEqual({ name: 'ping', description: 'Ping tool', enabled: true });
    const pongTool = plugin.tools[1];
    expect(pongTool).toBeDefined();
    expect(pongTool).toEqual({ name: 'pong', description: 'Pong tool', enabled: true });
  });

  test('tools respect enabled/disabled state from toolConfig', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [
          { name: 'enabled-tool', description: 'Enabled', input_schema: {}, output_schema: {} },
          { name: 'disabled-tool', description: 'Disabled', input_schema: {}, output_schema: {} },
        ],
      }),
    );
    state.toolConfig = { 'my-plugin_disabled-tool': false };

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 2 }), noopCallbacks);

    const rawConfig = ws.sent[0];
    expect(rawConfig).toBeDefined();
    const response = JSON.parse(rawConfig as string) as {
      result: { plugins: { tools: { name: string; description: string; enabled: boolean }[] }[] };
    };
    const pluginEntry = response.result.plugins[0];
    expect(pluginEntry).toBeDefined();
    const tools = (pluginEntry as NonNullable<typeof pluginEntry>).tools;

    const enabledTool = tools[0];
    expect(enabledTool).toBeDefined();
    expect(enabledTool).toEqual({ name: 'enabled-tool', description: 'Enabled', enabled: true });
    const disabledTool = tools[1];
    expect(disabledTool).toBeDefined();
    expect(disabledTool).toEqual({ name: 'disabled-tool', description: 'Disabled', enabled: false });
  });

  test('includes outdatedPlugins from state', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.outdatedPlugins = [
      { name: 'old-plugin', currentVersion: '1.0.0', latestVersion: '2.0.0', updateCommand: 'bun add old-plugin' },
    ];

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 3 }), noopCallbacks);

    const rawOutdated = ws.sent[0];
    expect(rawOutdated).toBeDefined();
    const response = JSON.parse(rawOutdated as string) as {
      result: {
        plugins: unknown[];
        outdatedPlugins: { name: string; currentVersion: string; latestVersion: string; updateCommand: string }[];
      };
    };

    expect(response.result.outdatedPlugins).toHaveLength(1);
    const outdatedEntry = response.result.outdatedPlugins[0];
    expect(outdatedEntry).toBeDefined();
    expect(outdatedEntry).toEqual({
      name: 'old-plugin',
      currentVersion: '1.0.0',
      latestVersion: '2.0.0',
      updateCommand: 'bun add old-plugin',
    });
  });

  test('tabState defaults to closed when no tabMapping entry exists', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'unmapped-plugin',
      makePlugin({
        name: 'unmapped-plugin',
        tools: [{ name: 'test', description: 'Test', input_schema: {}, output_schema: {} }],
      }),
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
    state.extensionWs = ws;

    state.plugins.set('no-display', makePlugin({ name: 'no-display' }));

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
    state.extensionWs = ws;

    handleExtensionMessage(state, JSON.stringify({ jsonrpc: '2.0', method: 'config.getState', id: 6 }), noopCallbacks);

    const rawEmptyPlugins = ws.sent[0];
    expect(rawEmptyPlugins).toBeDefined();
    const response = JSON.parse(rawEmptyPlugins as string) as {
      result: { plugins: unknown[]; outdatedPlugins: unknown[] };
    };

    expect(response.result.plugins).toEqual([]);
    expect(response.result.outdatedPlugins).toEqual([]);
  });
});

describe('handleExtensionMessage — config.setToolEnabled', () => {
  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    urlPatterns: [],
    trustTier: 'community',
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('valid params updates toolConfig with prefixed key and sends { ok: true }', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [{ name: 'send', description: 'Send', input_schema: {}, output_schema: {} }],
      }),
    );

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onToolConfigPersist: () => {
        configPersistCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'send', enabled: false },
        id: 1,
      }),
      callbacks,
    );

    expect(state.toolConfig['my-plugin_send']).toBe(false);
    expect(configChangedCalled).toBe(true);
    expect(configPersistCalled).toBe(true);

    expect(ws.sent).toHaveLength(1);
    const rawOk = ws.sent[0];
    expect(rawOk).toBeDefined();
    const response = JSON.parse(rawOk as string) as { jsonrpc: string; id: number; result: { ok: boolean } };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ ok: true });
  });

  test('enabling a tool sets toolConfig to true', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;
    state.toolConfig = { 'my-plugin_send': false };

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [{ name: 'send', description: 'Send', input_schema: {}, output_schema: {} }],
      }),
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'send', enabled: true },
        id: 2,
      }),
      noopCallbacks,
    );

    expect(state.toolConfig['my-plugin_send']).toBe(true);

    const rawEnable = ws.sent[0];
    expect(rawEnable).toBeDefined();
    const response = JSON.parse(rawEnable as string) as { result: { ok: boolean } };
    expect(response.result).toEqual({ ok: true });
  });

  test('missing params sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', method: 'config.setToolEnabled', id: 3 }),
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
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'send', enabled: 'yes' },
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

  test('missing enabled field sends -32602 error', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'send' },
        id: 5,
      }),
      noopCallbacks,
    );

    expect(ws.sent).toHaveLength(1);
    const rawEnabled = ws.sent[0];
    expect(rawEnabled).toBeDefined();
    const response = JSON.parse(rawEnabled as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid params');
  });

  test('callbacks are not invoked on invalid params', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onToolConfigPersist: () => {
        configPersistCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 123, tool: 'send', enabled: true },
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
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'nonexistent', tool: 'send', enabled: true },
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
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [{ name: 'send', description: 'Send', input_schema: {}, output_schema: {} }],
      }),
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'nonexistent-tool', enabled: true },
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
    state.extensionWs = ws;

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onToolConfigPersist: () => {
        configPersistCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'nonexistent', tool: 'send', enabled: true },
        id: 9,
      }),
      callbacks,
    );

    expect(configChangedCalled).toBe(false);
    expect(configPersistCalled).toBe(false);
  });

  test('nonexistent tool does not mutate toolConfig', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [{ name: 'send', description: 'Send', input_schema: {}, output_schema: {} }],
      }),
    );

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setToolEnabled',
        params: { plugin: 'my-plugin', tool: 'nonexistent-tool', enabled: true },
        id: 10,
      }),
      noopCallbacks,
    );

    expect(state.toolConfig).toEqual({});
  });
});

describe('handleExtensionMessage — config.setAllToolsEnabled', () => {
  const makePlugin = (overrides: Partial<RegisteredPlugin> & Pick<RegisteredPlugin, 'name'>): RegisteredPlugin => ({
    version: '1.0.0',
    urlPatterns: [],
    trustTier: 'community',
    iife: '// noop',
    tools: [],
    ...overrides,
  });

  test('enabling all tools sets every tool in toolConfig to true', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [
          { name: 'alpha', description: 'Alpha', input_schema: {}, output_schema: {} },
          { name: 'beta', description: 'Beta', input_schema: {}, output_schema: {} },
          { name: 'gamma', description: 'Gamma', input_schema: {}, output_schema: {} },
        ],
      }),
    );
    state.toolConfig = { 'my-plugin_alpha': false, 'my-plugin_beta': false, 'my-plugin_gamma': false };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setAllToolsEnabled',
        params: { plugin: 'my-plugin', enabled: true },
        id: 1,
      }),
      noopCallbacks,
    );

    expect(state.toolConfig['my-plugin_alpha']).toBe(true);
    expect(state.toolConfig['my-plugin_beta']).toBe(true);
    expect(state.toolConfig['my-plugin_gamma']).toBe(true);

    const rawAllEnabled = ws.sent[0];
    expect(rawAllEnabled).toBeDefined();
    const response = JSON.parse(rawAllEnabled as string) as { jsonrpc: string; id: number; result: { ok: boolean } };
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ ok: true });
  });

  test('disabling all tools sets every tool in toolConfig to false', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [
          { name: 'alpha', description: 'Alpha', input_schema: {}, output_schema: {} },
          { name: 'beta', description: 'Beta', input_schema: {}, output_schema: {} },
        ],
      }),
    );
    state.toolConfig = { 'my-plugin_alpha': true, 'my-plugin_beta': true };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setAllToolsEnabled',
        params: { plugin: 'my-plugin', enabled: false },
        id: 2,
      }),
      noopCallbacks,
    );

    expect(state.toolConfig['my-plugin_alpha']).toBe(false);
    expect(state.toolConfig['my-plugin_beta']).toBe(false);
  });

  test('both callbacks are invoked on valid request with existing plugin', () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    state.plugins.set(
      'my-plugin',
      makePlugin({
        name: 'my-plugin',
        tools: [{ name: 'alpha', description: 'Alpha', input_schema: {}, output_schema: {} }],
      }),
    );

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onToolConfigPersist: () => {
        configPersistCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setAllToolsEnabled',
        params: { plugin: 'my-plugin', enabled: true },
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
    state.extensionWs = ws;

    let configChangedCalled = false;
    let configPersistCalled = false;
    const callbacks = {
      onToolConfigChanged: () => {
        configChangedCalled = true;
      },
      onToolConfigPersist: () => {
        configPersistCalled = true;
      },
    };

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setAllToolsEnabled',
        params: { plugin: 'nonexistent', enabled: true },
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
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({ jsonrpc: '2.0', method: 'config.setAllToolsEnabled', id: 5 }),
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
    state.extensionWs = ws;

    handleExtensionMessage(
      state,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'config.setAllToolsEnabled',
        params: { plugin: 'my-plugin', enabled: 'yes' },
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

describe('dispatchToExtension — timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects with timeout error after DISPATCH_TIMEOUT_MS and removes pending entry', async () => {
    const state = createState();
    const ws = createMockWs();
    state.extensionWs = ws;

    const promise = dispatchToExtension(state, 'tool.dispatch', { plugin: 'slack', tool: 'echo' }, 'slack/echo');

    const rawTimeout = ws.sent[0];
    expect(rawTimeout).toBeDefined();
    const sent = parseJson(rawTimeout as string);
    const id = sent.id ?? -1;

    // Verify the pending dispatch exists before timeout
    expect(state.pendingDispatches.has(id)).toBe(true);

    // Advance time past the timeout
    jest.advanceTimersByTime(DISPATCH_TIMEOUT_MS);

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
    state.extensionWs = ws;

    const promise = dispatchToExtension(state, 'browser.openTab', { url: 'https://example.com' });

    jest.advanceTimersByTime(DISPATCH_TIMEOUT_MS);

    const err: unknown = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('browser.openTab');
    expect((err as Error).message).toContain('timed out');
  });
});

describe('writeAdapterFile', () => {
  let tmpDir: string;
  let adaptersDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(async () => {
    originalConfigDir = Bun.env.OPENTABS_CONFIG_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'opentabs-writeadapter-'));
    Bun.env.OPENTABS_CONFIG_DIR = tmpDir;
    adaptersDir = join(tmpDir, 'extension', 'adapters');
    await mkdir(adaptersDir, { recursive: true });
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      Bun.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete Bun.env.OPENTABS_CONFIG_DIR;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates the final file with correct content', async () => {
    const content = '(function(){ console.log("adapter"); })()';
    await writeAdapterFile('my-plugin', content);

    const finalPath = join(adaptersDir, 'my-plugin.js');
    const written = await Bun.file(finalPath).text();
    expect(written).toBe(content);
  });

  test('.tmp file does not exist after successful write (rename completed)', async () => {
    await writeAdapterFile('my-plugin', '// adapter code');

    const tmpPath = join(adaptersDir, 'my-plugin.js.tmp');
    expect(existsSync(tmpPath)).toBe(false);

    // Final file exists
    const finalPath = join(adaptersDir, 'my-plugin.js');
    expect(existsSync(finalPath)).toBe(true);
  });

  test('overwrite replaces existing file content', async () => {
    await writeAdapterFile('my-plugin', '// version 1');
    await writeAdapterFile('my-plugin', '// version 2');

    const finalPath = join(adaptersDir, 'my-plugin.js');
    const content = await Bun.file(finalPath).text();
    expect(content).toBe('// version 2');
  });

  test('concurrent writes to different plugin names do not interfere', async () => {
    const writes = [
      writeAdapterFile('plugin-a', '// adapter A'),
      writeAdapterFile('plugin-b', '// adapter B'),
      writeAdapterFile('plugin-c', '// adapter C'),
    ];
    await Promise.all(writes);

    const contentA = await Bun.file(join(adaptersDir, 'plugin-a.js')).text();
    const contentB = await Bun.file(join(adaptersDir, 'plugin-b.js')).text();
    const contentC = await Bun.file(join(adaptersDir, 'plugin-c.js')).text();

    expect(contentA).toBe('// adapter A');
    expect(contentB).toBe('// adapter B');
    expect(contentC).toBe('// adapter C');

    // No .tmp files left behind
    const entries = await readdir(adaptersDir);
    const tmpFiles = entries.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles).toEqual([]);
  });

  test('writes large IIFE content correctly', async () => {
    const largeContent = '// ' + 'x'.repeat(100_000);
    await writeAdapterFile('large-plugin', largeContent);

    const finalPath = join(adaptersDir, 'large-plugin.js');
    const written = await Bun.file(finalPath).text();
    expect(written).toBe(largeContent);
  });
});
