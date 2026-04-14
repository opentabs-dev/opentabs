import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { McpCallbacks } from './extension-handlers.js';
import {
  handleConfigGetState,
  handleConfigSetPluginPermission,
  handleConfigSetPluginSettings,
  handleConfigSetSkipPermissions,
  handleConfigSetToolPermission,
  handleConfirmationResponse,
  handlePluginInstall,
  handlePluginLog,
  handlePluginRemove,
  handlePluginRemoveBySpecifier,
  handlePluginSearch,
  handlePluginUpdateFromRegistry,
  handleServerSelfUpdate,
  handleTabStateChanged,
  handleTabSyncAll,
  handleToolProgress,
  rejectAllPendingConfirmations,
  sendToConnection,
  sendToExtension,
} from './extension-handlers.js';
import { clearAllLogs, getLogs } from './log-buffer.js';
import { searchNpmPlugins } from './plugin-management.js';
import type { ExtensionConnection, PendingConfirmation, PendingDispatch, RegisteredPlugin } from './state.js';
import { createState, DISPATCH_TIMEOUT_MS, getMergedTabMapping, MAX_DISPATCH_TIMEOUT_MS } from './state.js';

vi.mock('./plugin-management.js', () => ({
  searchNpmPlugins: vi.fn().mockResolvedValue([]),
  installPlugin: vi.fn().mockResolvedValue({ ok: true }),
  updatePlugin: vi.fn().mockResolvedValue({ ok: true }),
  removePlugin: vi.fn().mockResolvedValue({ ok: true }),
  removeFailedPlugin: vi.fn().mockResolvedValue({ ok: true }),
  checkPluginUpdates: vi.fn().mockResolvedValue([]),
}));

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));
vi.mock('./telemetry.js', () => ({
  trackEvent: mockTrackEvent,
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  spawnSync: vi.fn().mockReturnValue({ status: 0, error: null }),
}));

vi.mock('node:url', async importOriginal => {
  const original = await importOriginal<typeof import('node:url')>();
  return {
    ...original,
    fileURLToPath: (url: string) => {
      const real = original.fileURLToPath(url);
      // Make serverSourcePath include 'node_modules' so handleServerSelfUpdate tests work.
      // Match both forward and back slashes for Windows compatibility.
      if (real.includes('extension-handlers')) return real.replace(/platform[/\\]/, 'node_modules/platform/');
      return real;
    },
  };
});

/** Create a tracked PendingConfirmation that records resolve/reject calls */
const createPendingConfirmation = (
  overrides?: Partial<PendingConfirmation>,
): PendingConfirmation & { resolved: unknown; rejected: unknown } => {
  const result: PendingConfirmation & { resolved: unknown; rejected: unknown } = {
    resolved: undefined as unknown,
    rejected: undefined as unknown,
    resolve: decision => {
      result.resolved = decision;
    },
    reject: (err: Error) => {
      result.rejected = err;
    },
    tool: 'slack_send_message',
    plugin: 'slack',
    params: {},
    ...overrides,
  };
  return result;
};

/** No-op MCP callbacks */
const noopCallbacks: McpCallbacks = {
  onToolConfigChanged: () => {},
  onPluginPermissionsPersist: () => {},
  onPluginSettingsPersist: () => {},
  onPluginLog: () => {},
  onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
  queryExtension: () => Promise.resolve(undefined),
};

describe('handleConfirmationResponse', () => {
  test('allow resolves the pending confirmation', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-1', pending);

    handleConfirmationResponse(state, { id: 'conf-1', decision: 'allow' });

    expect(pending.resolved).toEqual({ action: 'allow', alwaysAllow: false });
    expect(state.pendingConfirmations.has('conf-1')).toBe(false);
  });

  test('deny resolves the pending confirmation with deny', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-2', pending);

    handleConfirmationResponse(state, { id: 'conf-2', decision: 'deny' });

    expect(pending.resolved).toEqual({ action: 'deny', alwaysAllow: false });
    expect(state.pendingConfirmations.has('conf-2')).toBe(false);
  });

  test('unknown id is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-3', pending);

    handleConfirmationResponse(state, { id: 'nonexistent', decision: 'allow' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-3')).toBe(true);
  });

  test('missing params is silently ignored', () => {
    const state = createState();
    handleConfirmationResponse(state, undefined);
    expect(state.pendingConfirmations.size).toBe(0);
  });

  test('invalid decision value is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-7', pending);

    handleConfirmationResponse(state, { id: 'conf-7', decision: 'invalid' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-7')).toBe(true);
  });

  test('non-string id is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-8', pending);

    handleConfirmationResponse(state, { id: 123, decision: 'allow' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-8')).toBe(true);
  });
});

describe('handleToolProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('forwards progress to onProgress callback', () => {
    const state = createState();
    let receivedProgress: { progress: number; total: number; message?: string } | undefined;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
      onProgress: (progress, total, message) => {
        receivedProgress = { progress, total, message };
      },
    };
    state.pendingDispatches.set('dispatch-1', pending);

    handleToolProgress(state, { dispatchId: 'dispatch-1', progress: 5, total: 10, message: 'Step 5' });

    expect(receivedProgress).toBeDefined();
    expect(receivedProgress?.progress).toBe(5);
    expect(receivedProgress?.total).toBe(10);
    expect(receivedProgress?.message).toBe('Step 5');

    clearTimeout(pending.timerId);
  });

  test('updates lastProgressTs on the pending dispatch', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-2', pending);

    expect(pending.lastProgressTs).toBeUndefined();

    handleToolProgress(state, { dispatchId: 'dispatch-2', progress: 1, total: 5 });

    expect(pending.lastProgressTs).toBeDefined();
    expect(typeof pending.lastProgressTs).toBe('number');

    clearTimeout(pending.timerId);
  });

  test('resets the dispatch timeout timer on progress', () => {
    const state = createState();
    let rejected: Error | undefined;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-3', pending);

    // Advance close to timeout
    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS - 5_000);
    expect(state.pendingDispatches.has('dispatch-3')).toBe(true);

    // Send progress — this should reset the timer
    handleToolProgress(state, { dispatchId: 'dispatch-3', progress: 1, total: 10 });

    // Advance past the original timeout — dispatch should still be alive
    vi.advanceTimersByTime(10_000);
    expect(state.pendingDispatches.has('dispatch-3')).toBe(true);
    expect(rejected).toBeUndefined();

    // Advance to trigger the new timeout (DISPATCH_TIMEOUT_MS from progress)
    vi.advanceTimersByTime(DISPATCH_TIMEOUT_MS);
    expect(state.pendingDispatches.has('dispatch-3')).toBe(false);
    expect(rejected).toBeDefined();
    expect(rejected?.message).toContain('timed out');
  });

  test('rejects immediately when elapsed exceeds MAX_DISPATCH_TIMEOUT_MS', () => {
    const state = createState();
    let rejected: Error | undefined;
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: err => {
        rejected = err;
      },
      label: 'test/forever',
      startTs: Date.now() - MAX_DISPATCH_TIMEOUT_MS - 1_000,
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-4', pending);

    handleToolProgress(state, { dispatchId: 'dispatch-4', progress: 1, total: 10 });

    expect(state.pendingDispatches.has('dispatch-4')).toBe(false);
    expect(rejected).toBeDefined();
    expect(rejected?.message).toContain('absolute max timeout');
    expect(rejected?.message).toContain(`${MAX_DISPATCH_TIMEOUT_MS}ms`);
  });

  test('missing dispatchId is silently ignored', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-5', pending);

    handleToolProgress(state, { progress: 1, total: 5 });

    expect(pending.lastProgressTs).toBeUndefined();
    clearTimeout(pending.timerId);
  });

  test('invalid dispatchId type is silently ignored', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-6', pending);

    handleToolProgress(state, { dispatchId: 123, progress: 1, total: 5 });

    expect(pending.lastProgressTs).toBeUndefined();
    clearTimeout(pending.timerId);
  });

  test('unknown dispatchId is silently ignored', () => {
    const state = createState();

    handleToolProgress(state, { dispatchId: 'nonexistent', progress: 1, total: 5 });

    expect(state.pendingDispatches.size).toBe(0);
  });

  test('missing params is silently ignored', () => {
    const state = createState();

    handleToolProgress(state, undefined);

    expect(state.pendingDispatches.size).toBe(0);
  });

  test('invalid progress/total types are silently ignored', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-7', pending);

    handleToolProgress(state, { dispatchId: 'dispatch-7', progress: 'five', total: 'ten' });

    expect(pending.lastProgressTs).toBeUndefined();
    clearTimeout(pending.timerId);
  });

  test('onProgress callback error does not break tool execution', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
      onProgress: () => {
        throw new Error('callback error');
      },
    };
    state.pendingDispatches.set('dispatch-8', pending);

    // Should not throw
    handleToolProgress(state, { dispatchId: 'dispatch-8', progress: 1, total: 5 });

    expect(pending.lastProgressTs).toBeDefined();
    expect(state.pendingDispatches.has('dispatch-8')).toBe(true);
    clearTimeout(pending.timerId);
  });

  test('progress without onProgress callback still updates lastProgressTs and resets timer', () => {
    const state = createState();
    const pending: PendingDispatch = {
      resolve: () => {},
      reject: () => {},
      label: 'test/tool',
      startTs: Date.now(),
      timerId: setTimeout(() => {}, DISPATCH_TIMEOUT_MS),
    };
    state.pendingDispatches.set('dispatch-9', pending);

    handleToolProgress(state, { dispatchId: 'dispatch-9', progress: 1, total: 5 });

    expect(pending.lastProgressTs).toBeDefined();
    expect(state.pendingDispatches.has('dispatch-9')).toBe(true);
    clearTimeout(pending.timerId);
  });
});

describe('rejectAllPendingConfirmations', () => {
  test('rejects all pending confirmations and clears the map', () => {
    const state = createState();
    const pending1 = createPendingConfirmation();
    const pending2 = createPendingConfirmation();
    const pending3 = createPendingConfirmation();
    state.pendingConfirmations.set('conf-a', pending1);
    state.pendingConfirmations.set('conf-b', pending2);
    state.pendingConfirmations.set('conf-c', pending3);

    rejectAllPendingConfirmations(state);

    expect(state.pendingConfirmations.size).toBe(0);
    expect(pending1.rejected).toBeInstanceOf(Error);
    expect((pending1.rejected as Error).message).toContain('Extension disconnected');
    expect(pending2.rejected).toBeInstanceOf(Error);
    expect((pending2.rejected as Error).message).toContain('Extension disconnected');
    expect(pending3.rejected).toBeInstanceOf(Error);
    expect((pending3.rejected as Error).message).toContain('Extension disconnected');
  });

  test('handles empty pendingConfirmations gracefully', () => {
    const state = createState();
    rejectAllPendingConfirmations(state);
    expect(state.pendingConfirmations.size).toBe(0);
  });
});

describe('handlePluginLog', () => {
  afterEach(() => {
    clearAllLogs();
  });

  test('valid entry is forwarded to onPluginLog callback', () => {
    let receivedEntry: unknown;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: entry => {
        receivedEntry = entry;
      },
    };

    handlePluginLog({ plugin: 'slack', level: 'info', message: 'Connected', ts: '2026-02-24T00:00:00Z' }, callbacks);

    expect(receivedEntry).toBeDefined();
    const entry = receivedEntry as { plugin: string; level: string; message: string; ts: string };
    expect(entry.plugin).toBe('slack');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Connected');
    expect(entry.ts).toBe('2026-02-24T00:00:00Z');
  });

  test('valid entry is appended to the log buffer', () => {
    handlePluginLog({ plugin: 'test-plugin', level: 'debug', message: 'Debug log' }, noopCallbacks);

    const logs = getLogs('test-plugin');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('Debug log');
    expect(logs[0]?.level).toBe('debug');
  });

  test('all valid log levels are accepted', () => {
    const levels = ['debug', 'info', 'warning', 'error'];
    let callCount = 0;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        callCount++;
      },
    };

    for (const level of levels) {
      handlePluginLog({ plugin: 'test', level, message: `${level} msg` }, callbacks);
    }

    expect(callCount).toBe(4);
  });

  test('missing params is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog(undefined, callbacks);

    expect(called).toBe(false);
  });

  test('invalid level is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog({ plugin: 'test', level: 'trace', message: 'msg' }, callbacks);

    expect(called).toBe(false);
  });

  test('empty plugin name is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog({ plugin: '', level: 'info', message: 'msg' }, callbacks);

    expect(called).toBe(false);
  });

  test('non-string plugin is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog({ plugin: 123, level: 'info', message: 'msg' }, callbacks);

    expect(called).toBe(false);
  });

  test('non-string message is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog({ plugin: 'test', level: 'info', message: 42 }, callbacks);

    expect(called).toBe(false);
  });

  test('non-string level is silently dropped', () => {
    let called = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: () => {
        called = true;
      },
    };

    handlePluginLog({ plugin: 'test', level: 123, message: 'msg' }, callbacks);

    expect(called).toBe(false);
  });

  test('missing ts uses auto-generated ISO timestamp', () => {
    let receivedEntry: unknown;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: entry => {
        receivedEntry = entry;
      },
    };

    handlePluginLog({ plugin: 'test', level: 'info', message: 'no ts' }, callbacks);

    expect(receivedEntry).toBeDefined();
    const entry = receivedEntry as { ts: string };
    expect(entry.ts).toBeDefined();
    // Verify it's a valid ISO timestamp
    expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
  });

  test('data field is forwarded when present', () => {
    let receivedEntry: unknown;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginLog: entry => {
        receivedEntry = entry;
      },
    };

    handlePluginLog({ plugin: 'test', level: 'info', message: 'with data', data: { key: 'value' } }, callbacks);

    expect(receivedEntry).toBeDefined();
    const entry = receivedEntry as { data: unknown };
    expect(entry.data).toEqual({ key: 'value' });
  });
});

describe('handleConfigGetState', () => {
  /** Create a mock WsHandle that captures sent JSON messages */
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  test('includes browserTools in the result', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List all open browser tabs', inputSchema: {}, tool: null as never },
      { name: 'browser_screenshot', description: 'Capture a screenshot', inputSchema: {}, tool: null as never },
    ];

    handleConfigGetState(state, 'req-1');

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: { name: string; description: string; permission: string }[] };
    };
    expect(response.result.browserTools).toHaveLength(2);
    expect(response.result.browserTools[0]).toEqual({
      name: 'browser_list_tabs',
      description: 'List all open browser tabs',
      permission: 'off',
    });
    expect(response.result.browserTools[1]).toEqual({
      name: 'browser_screenshot',
      description: 'Capture a screenshot',
      permission: 'off',
    });
  });

  test('browser tools are sorted alphabetically by name', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_screenshot', description: 'Screenshot', inputSchema: {}, tool: null as never },
      { name: 'browser_click', description: 'Click', inputSchema: {}, tool: null as never },
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];

    handleConfigGetState(state, 'req-2');

    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: { name: string }[] };
    };
    expect(response.result.browserTools.map(t => t.name)).toEqual([
      'browser_click',
      'browser_list_tabs',
      'browser_screenshot',
    ]);
  });

  test('browser tool disabled in browserToolPolicy has permission: off', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
      { name: 'browser_screenshot', description: 'Screenshot', inputSchema: {}, tool: null as never },
    ];
    state.pluginPermissions = { browser: { tools: { browser_list_tabs: 'off' } } };

    handleConfigGetState(state, 'req-3');

    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: { name: string; permission: string }[] };
    };
    const listTabs = response.result.browserTools.find(t => t.name === 'browser_list_tabs');
    const screenshot = response.result.browserTools.find(t => t.name === 'browser_screenshot');
    expect(listTabs?.permission).toBe('off');
    expect(screenshot?.permission).toBe('off');
  });

  test('empty cachedBrowserTools returns empty browserTools array', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigGetState(state, 'req-4');

    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: unknown[] };
    };
    expect(response.result.browserTools).toEqual([]);
  });

  test('includes serverVersion in the result', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigGetState(state, 'req-5');

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as {
      result: { serverVersion: unknown };
    };
    expect(typeof response.result.serverVersion).toBe('string');
    expect(response.result.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('handleConfigSetToolPermission', () => {
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  const makePlugin = (name: string, toolNames: string[] = ['do_thing']): RegisteredPlugin => ({
    name,
    version: '1.0.0',
    displayName: name,
    urlPatterns: ['https://example.com/*'],
    excludePatterns: [],
    iife: '',
    tools: toolNames.map(toolName => ({
      name: toolName,
      displayName: toolName,
      description: `Tool ${toolName}`,
      icon: 'activity',
      input_schema: {},
      output_schema: {},
    })),
    source: 'local',
  });

  test('sets plugin tool permission and returns { ok: true }', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'ask' },
      'req-1',
      noopCallbacks,
    );

    expect(state.pluginPermissions['test-plugin']?.tools?.do_thing).toBe('ask');
    expect(messages).toHaveLength(2);
    const notification = JSON.parse(messages[0] as string) as {
      method: string;
      params: { plugins: unknown[]; failedPlugins: unknown[]; browserTools: unknown[]; serverVersion: string };
    };
    expect(notification.method).toBe('plugins.changed');
    expect(Array.isArray(notification.params.plugins)).toBe(true);
    expect(Array.isArray(notification.params.failedPlugins)).toBe(true);
    expect(Array.isArray(notification.params.browserTools)).toBe(true);
    expect(typeof notification.params.serverVersion).toBe('string');
    const pluginEntry = notification.params.plugins.find(
      (p: unknown) => (p as { name: string }).name === 'test-plugin',
    ) as { tools: { name: string; permission: string }[] } | undefined;
    const tool = pluginEntry?.tools.find(t => t.name === 'do_thing');
    expect(tool?.permission).toBe('ask');
    const response = JSON.parse(messages[1] as string) as { result: { ok: boolean }; id: string };
    expect(response.result).toEqual({ ok: true });
    expect(response.id).toBe('req-1');
  });

  test('sets browser tool permission with plugin=browser', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];

    handleConfigSetToolPermission(
      state,
      { plugin: 'browser', tool: 'browser_list_tabs', permission: 'auto' },
      'req-2',
      noopCallbacks,
    );

    expect(state.pluginPermissions.browser?.tools?.browser_list_tabs).toBe('auto');
    expect(messages).toHaveLength(2);
    const response = JSON.parse(messages[1] as string) as { result: { ok: boolean } };
    expect(response.result).toEqual({ ok: true });
  });

  test('calls onToolConfigChanged and onPluginPermissionsPersist', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    let configChanged = false;
    let permissionsPersisted = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onToolConfigChanged: () => {
        configChanged = true;
      },
      onPluginPermissionsPersist: () => {
        permissionsPersisted = true;
      },
    };

    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'ask' },
      'req-3',
      callbacks,
    );

    expect(configChanged).toBe(true);
    expect(permissionsPersisted).toBe(true);
  });

  test('unknown plugin returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetToolPermission(
      state,
      { plugin: 'nonexistent', tool: 'do_thing', permission: 'off' },
      'req-4',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Plugin not found');
  });

  test('unknown tool returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'nonexistent', permission: 'off' },
      'req-5',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Tool not found');
  });

  test('unknown browser tool returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];

    handleConfigSetToolPermission(
      state,
      { plugin: 'browser', tool: 'nonexistent_tool', permission: 'off' },
      'req-6',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Browser tool not found');
  });

  test('invalid permission value returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'invalid' },
      'req-7',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid permission');
  });

  test('missing params returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetToolPermission(state, undefined, 'req-8', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toBe('Missing params');
  });

  test('invalid param types return error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetToolPermission(state, { plugin: 123, tool: 'do_thing', permission: 'yes' }, 'req-9', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('expected plugin (string)');
  });

  test('removes per-tool override when permission matches plugin default', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    // Plugin default is 'ask', tool has an override of 'auto'
    state.pluginPermissions['test-plugin'] = { permission: 'ask', tools: { do_thing: 'auto' } };

    // Set tool permission back to 'ask' (matches plugin default)
    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'ask' },
      'req-10',
      noopCallbacks,
    );

    // The per-tool override should be removed
    expect(state.pluginPermissions['test-plugin']?.tools?.do_thing).toBeUndefined();
  });

  test('creates per-tool override when permission differs from plugin default', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    state.pluginPermissions['test-plugin'] = { permission: 'ask' };

    // Set tool permission to 'auto' (differs from plugin default 'ask')
    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'auto' },
      'req-11',
      noopCallbacks,
    );

    expect(state.pluginPermissions['test-plugin']?.tools?.do_thing).toBe('auto');
  });

  test('removes tools map entirely when last override is cleaned up', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['do_thing']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    // Plugin default is 'off' (implicit), tool has an override
    state.pluginPermissions['test-plugin'] = { tools: { do_thing: 'auto' } };

    // Set tool back to 'off' (matches implicit default)
    handleConfigSetToolPermission(
      state,
      { plugin: 'test-plugin', tool: 'do_thing', permission: 'off' },
      'req-12',
      noopCallbacks,
    );

    expect(state.pluginPermissions['test-plugin']?.tools).toBeUndefined();
  });

  test('removes browser tool override when permission matches browser plugin default', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];
    // Browser plugin default is 'auto', tool has an override of 'ask'
    state.pluginPermissions.browser = { permission: 'auto', tools: { browser_list_tabs: 'ask' } };

    // Set tool permission back to 'auto' (matches browser plugin default)
    handleConfigSetToolPermission(
      state,
      { plugin: 'browser', tool: 'browser_list_tabs', permission: 'auto' },
      'req-13',
      noopCallbacks,
    );

    expect(state.pluginPermissions.browser?.tools?.browser_list_tabs).toBeUndefined();
  });
});

describe('handleConfigSetPluginPermission', () => {
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  const makePlugin = (name: string, toolNames: string[] = ['tool_a', 'tool_b']): RegisteredPlugin => ({
    name,
    version: '1.0.0',
    displayName: name,
    urlPatterns: ['https://example.com/*'],
    excludePatterns: [],
    iife: '',
    tools: toolNames.map(toolName => ({
      name: toolName,
      displayName: toolName,
      description: `Tool ${toolName}`,
      icon: 'activity',
      input_schema: {},
      output_schema: {},
    })),
    source: 'local',
  });

  test('sets plugin-level permission and sends plugins.changed', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['tool_a', 'tool_b']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetPluginPermission(state, { plugin: 'test-plugin', permission: 'auto' }, 'req-1', noopCallbacks);

    expect(state.pluginPermissions['test-plugin']?.permission).toBe('auto');
    expect(messages).toHaveLength(2);
    const notification = JSON.parse(messages[0] as string) as {
      method: string;
      params: { plugins: unknown[]; failedPlugins: unknown[]; browserTools: unknown[]; serverVersion: string };
    };
    expect(notification.method).toBe('plugins.changed');
    expect(Array.isArray(notification.params.plugins)).toBe(true);
    const response = JSON.parse(messages[1] as string) as { result: { ok: boolean }; id: string };
    expect(response.result).toEqual({ ok: true });
    expect(response.id).toBe('req-1');
  });

  test('sets browser plugin-level permission with plugin=browser', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetPluginPermission(state, { plugin: 'browser', permission: 'off' }, 'req-2', noopCallbacks);

    expect(state.pluginPermissions.browser?.permission).toBe('off');
    expect(messages).toHaveLength(2);
    const response = JSON.parse(messages[1] as string) as { result: { ok: boolean } };
    expect(response.result).toEqual({ ok: true });
  });

  test('clears per-tool overrides when plugin-level permission changes', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['tool_a', 'tool_b']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    // Set up existing per-tool overrides
    state.pluginPermissions = {
      'test-plugin': { permission: 'auto', tools: { tool_a: 'off', tool_b: 'ask' } },
    };

    handleConfigSetPluginPermission(state, { plugin: 'test-plugin', permission: 'off' }, 'req-clear', noopCallbacks);

    expect(state.pluginPermissions['test-plugin']?.permission).toBe('off');
    // Per-tool overrides should be cleared
    expect(state.pluginPermissions['test-plugin']?.tools).toBeUndefined();
  });

  test('clears browser per-tool overrides when browser plugin-level permission changes', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    state.pluginPermissions = {
      browser: { permission: 'ask', tools: { browser_screenshot_tab: 'off' } },
    };

    handleConfigSetPluginPermission(
      state,
      { plugin: 'browser', permission: 'auto' },
      'req-browser-clear',
      noopCallbacks,
    );

    expect(state.pluginPermissions.browser?.permission).toBe('auto');
    expect(state.pluginPermissions.browser?.tools).toBeUndefined();
  });

  test('preserves reviewedVersion when clearing per-tool overrides', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['tool_a']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    state.pluginPermissions = {
      'test-plugin': { permission: 'auto', tools: { tool_a: 'off' }, reviewedVersion: '1.0.0' },
    };

    handleConfigSetPluginPermission(state, { plugin: 'test-plugin', permission: 'ask' }, 'req-preserve', noopCallbacks);

    expect(state.pluginPermissions['test-plugin']?.permission).toBe('ask');
    expect(state.pluginPermissions['test-plugin']?.tools).toBeUndefined();
    expect(state.pluginPermissions['test-plugin']?.reviewedVersion).toBe('1.0.0');
  });

  test('calls onToolConfigChanged and onPluginPermissionsPersist', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin', ['tool_a']);
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    let configChanged = false;
    let permissionsPersisted = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onToolConfigChanged: () => {
        configChanged = true;
      },
      onPluginPermissionsPersist: () => {
        permissionsPersisted = true;
      },
    };

    handleConfigSetPluginPermission(state, { plugin: 'test-plugin', permission: 'ask' }, 'req-3', callbacks);

    expect(configChanged).toBe(true);
    expect(permissionsPersisted).toBe(true);
  });

  test('unknown plugin returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetPluginPermission(state, { plugin: 'nonexistent', permission: 'off' }, 'req-4', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Plugin not found');
  });

  test('invalid permission value returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('test-plugin');
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetPluginPermission(state, { plugin: 'test-plugin', permission: 'invalid' }, 'req-5', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Invalid permission');
  });

  test('missing params returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetPluginPermission(state, undefined, 'req-6', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toBe('Missing params');
  });

  test('invalid param types return error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    handleConfigSetPluginPermission(state, { plugin: 123, permission: 'yes' }, 'req-7', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('expected plugin (string)');
  });
});

describe('handleTabSyncAll — activeNetworkCaptures cleanup', () => {
  /** Create a state with a single test connection and return both */
  const createConnState = () => {
    const state = createState();
    const conn: ExtensionConnection = {
      ws: { send() {}, close() {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    return { state, conn };
  };

  test('removes stale activeNetworkCaptures entries for tabs absent from sync', () => {
    const { conn } = createConnState();
    // Tab 1 and 2 had active captures before the sync
    conn.activeNetworkCaptures.add(1);
    conn.activeNetworkCaptures.add(2);
    conn.activeNetworkCaptures.add(3);

    // Sync arrives: only tab 2 is still present
    handleTabSyncAll(
      {
        tabs: {
          slack: { state: 'ready', tabs: [{ tabId: 2, url: 'https://app.slack.com', ready: true }] },
        },
      },
      conn,
    );

    expect(conn.activeNetworkCaptures.has(1)).toBe(false);
    expect(conn.activeNetworkCaptures.has(2)).toBe(true);
    expect(conn.activeNetworkCaptures.has(3)).toBe(false);
  });

  test('clears all activeNetworkCaptures when sync has no tabs', () => {
    const { conn } = createConnState();
    conn.activeNetworkCaptures.add(10);
    conn.activeNetworkCaptures.add(20);

    handleTabSyncAll({ tabs: {} }, conn);

    expect(conn.activeNetworkCaptures.size).toBe(0);
  });

  test('retains activeNetworkCaptures entries for tabs still present after sync', () => {
    const { conn } = createConnState();
    conn.activeNetworkCaptures.add(5);

    handleTabSyncAll(
      {
        tabs: {
          slack: { state: 'ready', tabs: [{ tabId: 5, url: 'https://app.slack.com', ready: true }] },
        },
      },
      conn,
    );

    expect(conn.activeNetworkCaptures.has(5)).toBe(true);
  });
});

describe('handleTabStateChanged — activeNetworkCaptures cleanup', () => {
  /** Set up a state with a minimal registry and a single test connection */
  const withPlugin = (pluginName: string) => {
    const state = createState();
    state.registry = {
      ...state.registry,
      plugins: new Map([[pluginName, {} as RegisteredPlugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
    const conn: ExtensionConnection = {
      ws: { send() {}, close() {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    return { state, conn };
  };

  test('removes activeNetworkCaptures entry when a tab is removed from the plugin mapping', () => {
    const { state, conn } = withPlugin('slack');
    // Plugin currently has tabs 10 and 11, both with active captures
    conn.tabMapping.set('slack', {
      state: 'ready',
      tabs: [
        { tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true },
        { tabId: 11, url: 'https://app.slack.com', title: 'Slack', ready: true },
      ],
    });
    conn.activeNetworkCaptures.add(10);
    conn.activeNetworkCaptures.add(11);

    // State change arrives: only tab 10 remains
    handleTabStateChanged(
      state,
      {
        plugin: 'slack',
        state: 'ready',
        tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      },
      undefined,
      conn,
    );

    expect(conn.activeNetworkCaptures.has(10)).toBe(true);
    expect(conn.activeNetworkCaptures.has(11)).toBe(false);
  });

  test('removes all plugin tab activeNetworkCaptures entries when state changes to closed', () => {
    const { state, conn } = withPlugin('slack');
    conn.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 42, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    conn.activeNetworkCaptures.add(42);

    handleTabStateChanged(state, { plugin: 'slack', state: 'closed', tabs: [] }, undefined, conn);

    expect(conn.activeNetworkCaptures.has(42)).toBe(false);
  });

  test('does not touch activeNetworkCaptures for tabs that remain in the mapping', () => {
    const { state, conn } = withPlugin('slack');
    conn.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 7, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    conn.activeNetworkCaptures.add(7);

    // Same tab 7 still present
    handleTabStateChanged(
      state,
      {
        plugin: 'slack',
        state: 'ready',
        tabs: [{ tabId: 7, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      },
      undefined,
      conn,
    );

    expect(conn.activeNetworkCaptures.has(7)).toBe(true);
  });
});

describe('handlePluginRemove', () => {
  /** Create a mock WsHandle that captures sent JSON messages */
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  test('sends plugin.uninstall as a request via queryExtension, not as a notification', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const mockQueryExtension = vi.fn().mockResolvedValue({ success: true });
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      queryExtension: mockQueryExtension,
    };

    await handlePluginRemove(state, { name: 'test-plugin' }, 'req-1', callbacks);

    // queryExtension must be called with plugin.uninstall, the plugin name, and 5s timeout
    expect(mockQueryExtension).toHaveBeenCalledTimes(1);
    expect(mockQueryExtension).toHaveBeenCalledWith('plugin.uninstall', { name: 'test-plugin' }, 5000);

    // The direct sendToExtension call should NOT contain a plugin.uninstall notification
    const sentMessages = messages.map(m => JSON.parse(m) as Record<string, unknown>);
    const uninstallNotification = sentMessages.find(m => m.method === 'plugin.uninstall' && m.id === undefined);
    expect(uninstallNotification).toBeUndefined();
  });

  test('proceeds with plugins.changed and response even if queryExtension times out', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws: ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const mockQueryExtension = vi.fn().mockRejectedValue(new Error('Timeout'));
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      queryExtension: mockQueryExtension,
    };

    await handlePluginRemove(state, { name: 'test-plugin' }, 'req-2', callbacks);

    // Despite timeout, plugins.changed and the success response must still be sent
    const sentMessages = messages.map(m => JSON.parse(m) as Record<string, unknown>);
    const pluginsChanged = sentMessages.find(m => m.method === 'plugins.changed');
    expect(pluginsChanged).toBeDefined();

    const successResponse = sentMessages.find(m => m.id === 'req-2' && m.result !== undefined);
    expect(successResponse).toBeDefined();
  });
});

/** Helper to create a mock connection with tracked sent messages */
const createTrackedConnection = (id: string): { conn: ExtensionConnection; sent: string[] } => {
  const sent: string[] = [];
  const conn: ExtensionConnection = {
    ws: { send: (msg: string) => sent.push(msg), close() {} },
    connectionId: id,
    profileLabel: id,
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  };
  return { conn, sent };
};

describe('multi-connection — sendToExtension broadcasts to all', () => {
  test('broadcasts message to both connections', () => {
    const state = createState();
    const { conn: connA, sent: sentA } = createTrackedConnection('conn-a');
    const { conn: connB, sent: sentB } = createTrackedConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const result = sendToExtension(state, { jsonrpc: '2.0', method: 'test.broadcast' });

    expect(result).toBe(true);
    expect(sentA).toHaveLength(1);
    expect(sentB).toHaveLength(1);
    expect(sentA[0]).toBe(sentB[0]); // Same serialized message
  });

  test('returns false when no connections exist', () => {
    const state = createState();
    const result = sendToExtension(state, { jsonrpc: '2.0', method: 'test.broadcast' });
    expect(result).toBe(false);
  });

  test('returns true if at least one send succeeds when another throws', () => {
    const state = createState();
    const { conn: connA, sent: sentA } = createTrackedConnection('conn-a');
    const connB: ExtensionConnection = {
      ws: {
        send() {
          throw new Error('WebSocket closed');
        },
        close() {},
      },
      connectionId: 'conn-b',
      profileLabel: 'conn-b',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const result = sendToExtension(state, { jsonrpc: '2.0', method: 'test.broadcast' });

    expect(result).toBe(true);
    expect(sentA).toHaveLength(1);
  });
});

describe('multi-connection — sendToConnection sends to specific connection', () => {
  test('sends to the targeted connection only', () => {
    const state = createState();
    const { conn: connA, sent: sentA } = createTrackedConnection('conn-a');
    const { conn: connB, sent: sentB } = createTrackedConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const result = sendToConnection(state, 'conn-b', { jsonrpc: '2.0', method: 'test.targeted' });

    expect(result).toBe(true);
    expect(sentA).toHaveLength(0);
    expect(sentB).toHaveLength(1);
  });

  test('returns false when connection ID does not exist', () => {
    const state = createState();
    const result = sendToConnection(state, 'nonexistent', { jsonrpc: '2.0', method: 'test.targeted' });
    expect(result).toBe(false);
  });
});

describe('multi-connection — handleTabSyncAll scopes per-connection', () => {
  test('tab.syncAll from connection A does not clear connection B tabs', () => {
    const state = createState();
    const { conn: connA } = createTrackedConnection('conn-a');
    const { conn: connB } = createTrackedConnection('conn-b');

    // Connection B already has tabs
    connB.tabMapping.set('discord', {
      state: 'ready',
      tabs: [{ tabId: 100, url: 'https://discord.com', title: 'Discord', ready: true }],
    });

    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // Sync from connection A: only slack tabs
    handleTabSyncAll(
      {
        tabs: {
          slack: { state: 'ready', tabs: [{ tabId: 1, url: 'https://app.slack.com', ready: true }] },
        },
      },
      connA,
    );

    // Connection A's tab mapping is updated
    expect(connA.tabMapping.size).toBe(1);
    expect(connA.tabMapping.has('slack')).toBe(true);

    // Connection B's tab mapping is untouched
    expect(connB.tabMapping.size).toBe(1);
    expect(connB.tabMapping.has('discord')).toBe(true);

    // Merged view shows both
    const merged = getMergedTabMapping(state);
    expect(merged.size).toBe(2);
    expect(merged.has('slack')).toBe(true);
    expect(merged.has('discord')).toBe(true);
  });

  test('tab.syncAll from connection A replacing its own tabs does not affect connection B', () => {
    const state = createState();
    const { conn: connA } = createTrackedConnection('conn-a');
    const { conn: connB } = createTrackedConnection('conn-b');

    // Both connections initially have slack tabs
    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://app.slack.com', title: 'Slack 1', ready: true }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 2, url: 'https://app.slack.com', title: 'Slack 2', ready: true }],
    });

    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // Sync from connection A: now has no tabs
    handleTabSyncAll({ tabs: {} }, connA);

    // Connection A's tabs are cleared
    expect(connA.tabMapping.size).toBe(0);

    // Connection B's tabs are preserved
    expect(connB.tabMapping.size).toBe(1);
    expect(connB.tabMapping.get('slack')?.tabs[0]?.tabId).toBe(2);
  });
});

describe('multi-connection — handleTabStateChanged scopes per-connection', () => {
  test('tab.stateChanged updates only the sender connection tabMapping', () => {
    const state = createState();
    const { conn: connA } = createTrackedConnection('conn-a');
    const { conn: connB } = createTrackedConnection('conn-b');

    state.registry = {
      ...state.registry,
      plugins: new Map([['slack', {} as RegisteredPlugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack A', ready: true }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://app.slack.com', title: 'Slack B', ready: true }],
    });

    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    // State change from connection A: tab 10 is now unavailable
    handleTabStateChanged(
      state,
      {
        plugin: 'slack',
        state: 'unavailable',
        tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack A', ready: false }],
      },
      undefined,
      connA,
    );

    // Connection A's state updated
    expect(connA.tabMapping.get('slack')?.state).toBe('unavailable');

    // Connection B's state untouched
    expect(connB.tabMapping.get('slack')?.state).toBe('ready');
    expect(connB.tabMapping.get('slack')?.tabs[0]?.tabId).toBe(20);
  });
});

describe('handleConfigSetPluginSettings', () => {
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  const makePlugin = (name: string, configSchema?: Record<string, unknown>): RegisteredPlugin => ({
    name,
    version: '1.0.0',
    displayName: name,
    urlPatterns: ['https://example.com/*'],
    excludePatterns: [],
    iife: '',
    tools: [
      {
        name: 'tool_a',
        displayName: 'Tool A',
        description: 'A tool',
        icon: 'activity',
        input_schema: {},
        output_schema: {},
      },
    ],
    source: 'local',
    ...(configSchema ? { configSchema: configSchema as RegisteredPlugin['configSchema'] } : {}),
  });

  test('stores settings and broadcasts plugins.changed', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('my-plugin');
    state.registry = {
      ...state.registry,
      plugins: new Map([['my-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    let settingsPersisted = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onPluginSettingsPersist: () => {
        settingsPersisted = true;
      },
    };

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'my-plugin', settings: { url: 'https://example.com' } },
      'req-1',
      callbacks,
    );

    expect(state.pluginSettings['my-plugin']).toEqual({ url: 'https://example.com' });
    expect(settingsPersisted).toBe(true);
    // plugins.changed notification + ok response
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const notification = JSON.parse(messages[0] as string) as { method: string };
    expect(notification.method).toBe('plugins.changed');
    const response = JSON.parse(messages[messages.length - 1] as string) as { result: { ok: boolean }; id: string };
    expect(response.result).toEqual({ ok: true });
    expect(response.id).toBe('req-1');
  });

  test('validates required fields against configSchema', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('my-plugin', {
      instanceUrl: { type: 'url', label: 'Instance URL', required: true },
    });
    state.registry = {
      ...state.registry,
      plugins: new Map([['my-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handleConfigSetPluginSettings(state, { plugin: 'my-plugin', settings: {} }, 'req-2', noopCallbacks);

    expect(messages).toHaveLength(1);
    const error = JSON.parse(messages[0] as string) as { error: { message: string } };
    expect(error.error.message).toContain('required');
  });

  test('validates type mismatch against configSchema', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('my-plugin', {
      count: { type: 'number', label: 'Count' },
    });
    state.registry = {
      ...state.registry,
      plugins: new Map([['my-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'my-plugin', settings: { count: 'not-a-number' } },
      'req-3',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const error = JSON.parse(messages[0] as string) as { error: { message: string } };
    expect(error.error.message).toContain('must be a number');
  });

  test('validates select options against configSchema', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });
    const plugin = makePlugin('my-plugin', {
      theme: { type: 'select', label: 'Theme', options: ['light', 'dark'] },
    });
    state.registry = {
      ...state.registry,
      plugins: new Map([['my-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'my-plugin', settings: { theme: 'neon' } },
      'req-4',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const error = JSON.parse(messages[0] as string) as { error: { message: string } };
    expect(error.error.message).toContain('must be one of');
  });

  test('rejects missing params', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await handleConfigSetPluginSettings(state, undefined, 'req-5', noopCallbacks);

    expect(messages).toHaveLength(1);
    const error = JSON.parse(messages[0] as string) as { error: { message: string } };
    expect(error.error.message).toBe('Missing params');
  });

  test('rejects non-object settings', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'my-plugin', settings: 'not-an-object' },
      'req-6',
      noopCallbacks,
    );

    expect(messages).toHaveLength(1);
    const error = JSON.parse(messages[0] as string) as { error: { message: string } };
    expect(error.error.message).toContain('settings must be an object');
  });

  test('stores settings for unloaded plugins (lenient mode)', async () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionConnections.set('test-conn', {
      ws,
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    });

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'not-loaded', settings: { key: 'value' } },
      'req-7',
      noopCallbacks,
    );

    expect(state.pluginSettings['not-loaded']).toEqual({ key: 'value' });
    const response = JSON.parse(messages[messages.length - 1] as string) as { result: { ok: boolean } };
    expect(response.result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Telemetry event tests
// ---------------------------------------------------------------------------

/** Assert no trackEvent call includes privacy-violating properties */
const assertNoPrivacyViolation = (calls: unknown[][]): void => {
  for (const [, props] of calls) {
    const p = props as Record<string, unknown>;
    expect(p).not.toHaveProperty('plugin_name');
    expect(p).not.toHaveProperty('plugin');
    expect(p).not.toHaveProperty('query');
    expect(p).not.toHaveProperty('error_message');
    expect(p).not.toHaveProperty('version');
    expect(p).not.toHaveProperty('package_name');
  }
};

/** Shared test setup: create state with a mock WS connection */
const createTelemetryTestState = (): {
  state: ReturnType<typeof createState>;
  messages: string[];
} => {
  const messages: string[] = [];
  const state = createState();
  state.extensionConnections.set('test-conn', {
    ws: { send: (msg: string) => messages.push(msg), close: () => {} },
    connectionId: 'test-conn',
    profileLabel: 'test-conn',
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  });
  return { state, messages };
};

describe('telemetry events', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  // --- plugin_installed ---

  test('plugin_installed is emitted on successful install', async () => {
    const { state } = createTelemetryTestState();

    await handlePluginInstall(state, { name: 'some-plugin' }, 'req-1', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_installed', {
      session_id: 'test-session-id',
      source: 'side_panel',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  // --- plugin_install_failed ---

  test('plugin_install_failed emits timeout error_category', async () => {
    const { installPlugin } = await import('./plugin-management.js');
    vi.mocked(installPlugin).mockRejectedValueOnce(new Error('Install timed out after 30s'));

    const { state } = createTelemetryTestState();
    await handlePluginInstall(state, { name: 'bad-plugin' }, 'req-2', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_install_failed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      error_category: 'timeout',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('plugin_install_failed emits invalid_plugin error_category', async () => {
    const { installPlugin } = await import('./plugin-management.js');
    vi.mocked(installPlugin).mockRejectedValueOnce(new Error('not a valid opentabs plugin'));

    const { state } = createTelemetryTestState();
    await handlePluginInstall(state, { name: 'bad-plugin' }, 'req-3', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_install_failed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      error_category: 'invalid_plugin',
    });
  });

  test('plugin_install_failed emits npm_failure error_category for generic errors', async () => {
    const { installPlugin } = await import('./plugin-management.js');
    vi.mocked(installPlugin).mockRejectedValueOnce(new Error('npm ERR! code E404'));

    const { state } = createTelemetryTestState();
    await handlePluginInstall(state, { name: 'bad-plugin' }, 'req-4', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_install_failed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      error_category: 'npm_failure',
    });
  });

  // --- plugin_removed (successful plugin) ---

  test('plugin_removed is emitted with was_failed false for normal removal', async () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'npm',
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handlePluginRemove(state, { name: 'test-plugin' }, 'req-5', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_removed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      was_failed: false,
      plugin_source: 'npm',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('plugin_removed reports local source correctly', async () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'local-plugin',
      version: '1.0.0',
      displayName: 'Local',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'local',
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['local-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handlePluginRemove(state, { name: 'local-plugin' }, 'req-6', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_removed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      was_failed: false,
      plugin_source: 'local',
    });
  });

  // --- plugin_removed (failed plugin via specifier) ---

  test('plugin_removed is emitted with was_failed true for removeBySpecifier', async () => {
    const { state } = createTelemetryTestState();

    await handlePluginRemoveBySpecifier(state, { specifier: '/path/to/failed' }, 'req-7', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_removed', {
      session_id: 'test-session-id',
      source: 'side_panel',
      was_failed: true,
      plugin_source: 'unknown',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  // --- plugin_updated ---

  test('plugin_updated is emitted on successful update', async () => {
    const { state } = createTelemetryTestState();

    await handlePluginUpdateFromRegistry(state, { name: 'some-plugin' }, 'req-8', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_updated', {
      session_id: 'test-session-id',
      source: 'side_panel',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  // --- permission_changed ---

  test('permission_changed is emitted for plugin permission', () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'my-plugin',
      version: '1.0.0',
      displayName: 'My',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'local',
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['my-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    handleConfigSetPluginPermission(state, { plugin: 'my-plugin', permission: 'auto' }, 'req-9', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('permission_changed', {
      session_id: 'test-session-id',
      target: 'plugin',
      new_permission: 'auto',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('permission_changed emits target browser for browser plugin', () => {
    const { state } = createTelemetryTestState();

    handleConfigSetPluginPermission(state, { plugin: 'browser', permission: 'ask' }, 'req-10', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('permission_changed', {
      session_id: 'test-session-id',
      target: 'browser',
      new_permission: 'ask',
    });
  });

  // --- skip_permissions_changed ---

  test('skip_permissions_changed is emitted when toggled on', () => {
    const { state } = createTelemetryTestState();

    handleConfigSetSkipPermissions(state, { skipPermissions: true }, 'req-11', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('skip_permissions_changed', {
      session_id: 'test-session-id',
      enabled: true,
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('skip_permissions_changed is emitted when toggled off', () => {
    const { state } = createTelemetryTestState();

    handleConfigSetSkipPermissions(state, { skipPermissions: false }, 'req-12', noopCallbacks);

    expect(mockTrackEvent).toHaveBeenCalledWith('skip_permissions_changed', {
      session_id: 'test-session-id',
      enabled: false,
    });
  });

  // --- plugin_search ---

  test('plugin_search emits result_count_bucket 0 for empty results', async () => {
    vi.mocked(searchNpmPlugins).mockResolvedValueOnce([]);
    const { state } = createTelemetryTestState();

    await handlePluginSearch(state, { query: 'test' }, 'req-13');

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_search', {
      session_id: 'test-session-id',
      source: 'side_panel',
      result_count_bucket: '0',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('plugin_search emits result_count_bucket 1-5 for 3 results', async () => {
    const fakeResults = Array.from({ length: 3 }, (_, i) => ({ name: `p${i}`, description: '' }));
    vi.mocked(searchNpmPlugins).mockResolvedValueOnce(fakeResults as never);
    const { state } = createTelemetryTestState();

    await handlePluginSearch(state, { query: 'test' }, 'req-14');

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_search', {
      session_id: 'test-session-id',
      source: 'side_panel',
      result_count_bucket: '1-5',
    });
  });

  test('plugin_search emits result_count_bucket 6+ for 10 results', async () => {
    const fakeResults = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, description: '' }));
    vi.mocked(searchNpmPlugins).mockResolvedValueOnce(fakeResults as never);
    const { state } = createTelemetryTestState();

    await handlePluginSearch(state, { query: 'test' }, 'req-15');

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_search', {
      session_id: 'test-session-id',
      source: 'side_panel',
      result_count_bucket: '6+',
    });
  });

  // --- plugin_configured ---

  test('plugin_configured is emitted with had_required_fields true', async () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'cfg-plugin',
      version: '1.0.0',
      displayName: 'Cfg',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'local',
      configSchema: {
        apiKey: { type: 'string', label: 'API Key', required: true },
      } as RegisteredPlugin['configSchema'],
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['cfg-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'cfg-plugin', settings: { apiKey: 'my-secret-key' } },
      'req-16',
      noopCallbacks,
    );

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_configured', {
      session_id: 'test-session-id',
      source: 'side_panel',
      had_required_fields: true,
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  test('plugin_configured is emitted with had_required_fields false', async () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'opt-plugin',
      version: '1.0.0',
      displayName: 'Opt',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'local',
      configSchema: {
        theme: { type: 'string', label: 'Theme', required: false },
      } as RegisteredPlugin['configSchema'],
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['opt-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    await handleConfigSetPluginSettings(
      state,
      { plugin: 'opt-plugin', settings: { theme: 'dark' } },
      'req-17',
      noopCallbacks,
    );

    expect(mockTrackEvent).toHaveBeenCalledWith('plugin_configured', {
      session_id: 'test-session-id',
      source: 'side_panel',
      had_required_fields: false,
    });
  });

  // --- server_update_applied ---

  test('server_update_applied is emitted after successful self-update', async () => {
    const { state } = createTelemetryTestState();
    state.serverUpdate = { latestVersion: '99.0.0', updateCommand: 'npm install -g @opentabs-dev/cli@99.0.0' };

    await handleServerSelfUpdate(state, 'req-18');

    expect(mockTrackEvent).toHaveBeenCalledWith('server_update_applied', {
      session_id: 'test-session-id',
    });
    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });

  // --- privacy: no events leak forbidden fields ---

  test('no telemetry event includes forbidden privacy-violating fields', async () => {
    const { state } = createTelemetryTestState();
    const plugin: RegisteredPlugin = {
      name: 'test-plugin',
      version: '2.0.0',
      displayName: 'Test',
      urlPatterns: ['https://example.com/*'],
      excludePatterns: [],
      iife: '',
      tools: [],
      source: 'npm',
    };
    state.registry = {
      ...state.registry,
      plugins: new Map([['test-plugin', plugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };

    // Trigger multiple events
    await handlePluginInstall(state, { name: 'some-plugin' }, 'r1', noopCallbacks);
    await handlePluginRemove(state, { name: 'test-plugin' }, 'r2', noopCallbacks);
    handleConfigSetPluginPermission(state, { plugin: 'browser', permission: 'auto' }, 'r3', noopCallbacks);
    handleConfigSetSkipPermissions(state, { skipPermissions: true }, 'r4', noopCallbacks);

    assertNoPrivacyViolation(mockTrackEvent.mock.calls);
  });
});
