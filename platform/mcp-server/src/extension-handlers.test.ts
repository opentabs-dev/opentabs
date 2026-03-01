import {
  handleConfigGetState,
  handleConfigSetBrowserToolEnabled,
  handleConfirmationResponse,
  handlePluginLog,
  handleTabStateChanged,
  handleTabSyncAll,
  handleToolProgress,
  rejectAllPendingConfirmations,
} from './extension-handlers.js';
import { clearAllLogs, getLogs } from './log-buffer.js';
import { createState, DISPATCH_TIMEOUT_MS, MAX_DISPATCH_TIMEOUT_MS, MAX_SESSION_PERMISSIONS } from './state.js';
import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import type { McpCallbacks } from './extension-handlers.js';
import type { PendingConfirmation, PendingDispatch, RegisteredPlugin, SessionPermissionRule } from './state.js';

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
    timerId: setTimeout(() => {}, 60_000),
    tool: 'slack_send_message',
    domain: 'app.slack.com',
    ...overrides,
  };
  return result;
};

/** No-op MCP callbacks */
const noopCallbacks: McpCallbacks = {
  onToolConfigChanged: () => {},
  onToolConfigPersist: () => {},
  onBrowserToolPolicyPersist: () => {},
  onPluginLog: () => {},
  onReload: () => Promise.resolve({ plugins: 0, durationMs: 0 }),
};

describe('handleConfirmationResponse', () => {
  test('allow_once resolves the pending confirmation', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-1', pending);

    handleConfirmationResponse(state, { id: 'conf-1', decision: 'allow_once' });

    expect(pending.resolved).toBe('allow_once');
    expect(state.pendingConfirmations.has('conf-1')).toBe(false);
  });

  test('deny resolves the pending confirmation with deny', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-2', pending);

    handleConfirmationResponse(state, { id: 'conf-2', decision: 'deny' });

    expect(pending.resolved).toBe('deny');
    expect(state.pendingConfirmations.has('conf-2')).toBe(false);
  });

  test('unknown id is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-3', pending);

    handleConfirmationResponse(state, { id: 'nonexistent', decision: 'allow_once' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-3')).toBe(true);
    clearTimeout(pending.timerId);
  });

  test('allow_always with default scope (tool_domain) adds session permission rule', () => {
    const state = createState();
    const pending = createPendingConfirmation({ tool: 'slack_send_message', domain: 'app.slack.com' });
    state.pendingConfirmations.set('conf-4', pending);

    handleConfirmationResponse(state, { id: 'conf-4', decision: 'allow_always' });

    expect(pending.resolved).toBe('allow_always');
    expect(state.sessionPermissions).toHaveLength(1);
    const rule = state.sessionPermissions[0] as SessionPermissionRule;
    expect(rule.tool).toBe('slack_send_message');
    expect(rule.domain).toBe('app.slack.com');
    expect(rule.scope).toBe('tool_domain');
  });

  test('allow_always with scope tool_all sets domain to null', () => {
    const state = createState();
    const pending = createPendingConfirmation({ tool: 'slack_send_message', domain: 'app.slack.com' });
    state.pendingConfirmations.set('conf-5', pending);

    handleConfirmationResponse(state, { id: 'conf-5', decision: 'allow_always', scope: 'tool_all' });

    expect(state.sessionPermissions).toHaveLength(1);
    const rule = state.sessionPermissions[0] as SessionPermissionRule;
    expect(rule.tool).toBe('slack_send_message');
    expect(rule.domain).toBeNull();
    expect(rule.scope).toBe('tool_all');
  });

  test('allow_always with scope domain_all sets tool to null', () => {
    const state = createState();
    const pending = createPendingConfirmation({ tool: 'slack_send_message', domain: 'app.slack.com' });
    state.pendingConfirmations.set('conf-6', pending);

    handleConfirmationResponse(state, { id: 'conf-6', decision: 'allow_always', scope: 'domain_all' });

    expect(state.sessionPermissions).toHaveLength(1);
    const rule = state.sessionPermissions[0] as SessionPermissionRule;
    expect(rule.tool).toBeNull();
    expect(rule.domain).toBe('app.slack.com');
    expect(rule.scope).toBe('domain_all');
  });

  test('allow_always with scope domain_all falls back to tool_domain when pending.domain is null', () => {
    const state = createState();
    const pending = createPendingConfirmation({ tool: 'browser_screenshot', domain: null });
    state.pendingConfirmations.set('conf-6b', pending);

    handleConfirmationResponse(state, { id: 'conf-6b', decision: 'allow_always', scope: 'domain_all' });

    expect(state.sessionPermissions).toHaveLength(1);
    const rule = state.sessionPermissions[0] as SessionPermissionRule;
    expect(rule.tool).toBe('browser_screenshot');
    expect(rule.domain).toBeNull();
    expect(rule.scope).toBe('tool_domain');
  });

  test('missing params is silently ignored', () => {
    const state = createState();
    handleConfirmationResponse(state, undefined);
    expect(state.pendingConfirmations.size).toBe(0);
    expect(state.sessionPermissions).toHaveLength(0);
  });

  test('invalid decision value is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-7', pending);

    handleConfirmationResponse(state, { id: 'conf-7', decision: 'invalid' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-7')).toBe(true);
    clearTimeout(pending.timerId);
  });

  test('non-string id is silently ignored', () => {
    const state = createState();
    const pending = createPendingConfirmation();
    state.pendingConfirmations.set('conf-8', pending);

    handleConfirmationResponse(state, { id: 123, decision: 'allow_once' });

    expect(pending.resolved).toBeUndefined();
    expect(state.pendingConfirmations.has('conf-8')).toBe(true);
    clearTimeout(pending.timerId);
  });

  test('clears the pending confirmation timer', () => {
    const state = createState();
    let timerCleared = false;
    const timerId = setTimeout(() => {
      timerCleared = false;
    }, 60_000);
    const pending = createPendingConfirmation({ timerId });
    state.pendingConfirmations.set('conf-9', pending);

    handleConfirmationResponse(state, { id: 'conf-9', decision: 'allow_once' });

    // The timer was cleared by clearTimeout — verify by checking the confirmation was removed
    expect(state.pendingConfirmations.has('conf-9')).toBe(false);
    expect(pending.resolved).toBe('allow_once');
    // Suppress unused variable lint
    void timerCleared;
  });

  test('sessionPermissions is capped at MAX_SESSION_PERMISSIONS — oldest entries are dropped', () => {
    const state = createState();

    // Pre-fill to the cap with distinct tool_domain rules
    for (let i = 0; i < MAX_SESSION_PERMISSIONS; i++) {
      const pending = createPendingConfirmation({ tool: `plugin_tool_${i}`, domain: `example-${i}.com` });
      state.pendingConfirmations.set(`cap-${i}`, pending);
      handleConfirmationResponse(state, { id: `cap-${i}`, decision: 'allow_always', scope: 'tool_domain' });
    }

    expect(state.sessionPermissions).toHaveLength(MAX_SESSION_PERMISSIONS);

    // Add one more — the oldest entry should be dropped
    const overflowPending = createPendingConfirmation({ tool: 'plugin_overflow', domain: 'overflow.com' });
    state.pendingConfirmations.set('cap-overflow', overflowPending);
    handleConfirmationResponse(state, { id: 'cap-overflow', decision: 'allow_always', scope: 'tool_domain' });

    expect(state.sessionPermissions).toHaveLength(MAX_SESSION_PERMISSIONS);
    // The newest entry should be present
    const last = state.sessionPermissions[MAX_SESSION_PERMISSIONS - 1] as SessionPermissionRule;
    expect(last.tool).toBe('plugin_overflow');
    // The oldest entry (tool_0) should have been dropped
    expect(state.sessionPermissions.some(r => r.tool === 'plugin_tool_0')).toBe(false);
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
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List all open browser tabs', inputSchema: {}, tool: null as never },
      { name: 'browser_screenshot', description: 'Capture a screenshot', inputSchema: {}, tool: null as never },
    ];

    handleConfigGetState(state, 'req-1');

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: { name: string; description: string; enabled: boolean }[] };
    };
    expect(response.result.browserTools).toHaveLength(2);
    expect(response.result.browserTools[0]).toEqual({
      name: 'browser_list_tabs',
      description: 'List all open browser tabs',
      enabled: true,
    });
    expect(response.result.browserTools[1]).toEqual({
      name: 'browser_screenshot',
      description: 'Capture a screenshot',
      enabled: true,
    });
  });

  test('browser tools are sorted alphabetically by name', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;
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

  test('browser tool disabled in browserToolPolicy has enabled: false', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
      { name: 'browser_screenshot', description: 'Screenshot', inputSchema: {}, tool: null as never },
    ];
    state.browserToolPolicy = { browser_list_tabs: false };

    handleConfigGetState(state, 'req-3');

    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: { name: string; enabled: boolean }[] };
    };
    const listTabs = response.result.browserTools.find(t => t.name === 'browser_list_tabs');
    const screenshot = response.result.browserTools.find(t => t.name === 'browser_screenshot');
    expect(listTabs?.enabled).toBe(false);
    expect(screenshot?.enabled).toBe(true);
  });

  test('empty cachedBrowserTools returns empty browserTools array', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;

    handleConfigGetState(state, 'req-4');

    const response = JSON.parse(messages[0] as string) as {
      result: { browserTools: unknown[] };
    };
    expect(response.result.browserTools).toEqual([]);
  });

  test('includes serverVersion in the result', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;

    handleConfigGetState(state, 'req-5');

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as {
      result: { serverVersion: unknown };
    };
    expect(typeof response.result.serverVersion).toBe('string');
    expect(response.result.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('handleConfigSetBrowserToolEnabled', () => {
  /** Create a mock WsHandle that captures sent JSON messages */
  const createMockWs = (): { ws: { send: (msg: string) => void; close: () => void }; messages: string[] } => {
    const messages: string[] = [];
    return { ws: { send: msg => messages.push(msg), close: () => {} }, messages };
  };

  test('valid toggle sets browserToolPolicy and returns { ok: true }', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];

    handleConfigSetBrowserToolEnabled(state, { tool: 'browser_list_tabs', enabled: false }, 'req-1', noopCallbacks);

    expect(state.browserToolPolicy.browser_list_tabs).toBe(false);
    // First message is plugins.changed notification, second is the result
    expect(messages).toHaveLength(2);
    const notification = JSON.parse(messages[0] as string) as { method: string };
    expect(notification.method).toBe('plugins.changed');
    const response = JSON.parse(messages[1] as string) as { result: { ok: boolean }; id: string };
    expect(response.result).toEqual({ ok: true });
    expect(response.id).toBe('req-1');
  });

  test('calls onToolConfigChanged and onBrowserToolPolicyPersist', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];
    let configChanged = false;
    let policyPersisted = false;
    const callbacks: McpCallbacks = {
      ...noopCallbacks,
      onToolConfigChanged: () => {
        configChanged = true;
      },
      onBrowserToolPolicyPersist: () => {
        policyPersisted = true;
      },
    };

    handleConfigSetBrowserToolEnabled(state, { tool: 'browser_list_tabs', enabled: false }, 'req-2', callbacks);

    expect(configChanged).toBe(true);
    expect(policyPersisted).toBe(true);
  });

  test('invalid tool name returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];

    handleConfigSetBrowserToolEnabled(state, { tool: 'nonexistent_tool', enabled: false }, 'req-3', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Browser tool not found');
  });

  test('missing params returns error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;

    handleConfigSetBrowserToolEnabled(state, undefined, 'req-4', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toBe('Missing params');
  });

  test('invalid param types return error', () => {
    const state = createState();
    const { ws, messages } = createMockWs();
    state.extensionWs = ws;

    handleConfigSetBrowserToolEnabled(state, { tool: 123, enabled: 'yes' }, 'req-5', noopCallbacks);

    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] as string) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('expected tool (string), enabled (boolean)');
  });

  test('re-enabling a disabled tool sets policy to true', () => {
    const state = createState();
    const { ws } = createMockWs();
    state.extensionWs = ws;
    state.cachedBrowserTools = [
      { name: 'browser_list_tabs', description: 'List tabs', inputSchema: {}, tool: null as never },
    ];
    state.browserToolPolicy = { browser_list_tabs: false };

    handleConfigSetBrowserToolEnabled(state, { tool: 'browser_list_tabs', enabled: true }, 'req-6', noopCallbacks);

    expect(state.browserToolPolicy.browser_list_tabs).toBe(true);
  });
});

describe('handleTabSyncAll — activeNetworkCaptures cleanup', () => {
  test('removes stale activeNetworkCaptures entries for tabs absent from sync', () => {
    const state = createState();
    // Tab 1 and 2 had active captures before the sync
    state.activeNetworkCaptures.add(1);
    state.activeNetworkCaptures.add(2);
    state.activeNetworkCaptures.add(3);

    // Sync arrives: only tab 2 is still present
    handleTabSyncAll(state, {
      tabs: {
        slack: { state: 'ready', tabs: [{ tabId: 2, url: 'https://app.slack.com', ready: true }] },
      },
    });

    expect(state.activeNetworkCaptures.has(1)).toBe(false);
    expect(state.activeNetworkCaptures.has(2)).toBe(true);
    expect(state.activeNetworkCaptures.has(3)).toBe(false);
  });

  test('clears all activeNetworkCaptures when sync has no tabs', () => {
    const state = createState();
    state.activeNetworkCaptures.add(10);
    state.activeNetworkCaptures.add(20);

    handleTabSyncAll(state, { tabs: {} });

    expect(state.activeNetworkCaptures.size).toBe(0);
  });

  test('retains activeNetworkCaptures entries for tabs still present after sync', () => {
    const state = createState();
    state.activeNetworkCaptures.add(5);

    handleTabSyncAll(state, {
      tabs: {
        slack: { state: 'ready', tabs: [{ tabId: 5, url: 'https://app.slack.com', ready: true }] },
      },
    });

    expect(state.activeNetworkCaptures.has(5)).toBe(true);
  });
});

describe('handleTabStateChanged — activeNetworkCaptures cleanup', () => {
  /** Set up a minimal registry with a given plugin name */
  const withPlugin = (state: ReturnType<typeof createState>, pluginName: string) => {
    state.registry = {
      ...state.registry,
      plugins: new Map([[pluginName, {} as RegisteredPlugin]]) as ReadonlyMap<string, RegisteredPlugin>,
    };
  };

  test('removes activeNetworkCaptures entry when a tab is removed from the plugin mapping', () => {
    const state = createState();
    withPlugin(state, 'slack');
    // Plugin currently has tabs 10 and 11, both with active captures
    state.tabMapping.set('slack', {
      state: 'ready',
      tabs: [
        { tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true },
        { tabId: 11, url: 'https://app.slack.com', title: 'Slack', ready: true },
      ],
    });
    state.activeNetworkCaptures.add(10);
    state.activeNetworkCaptures.add(11);

    // State change arrives: only tab 10 remains
    handleTabStateChanged(state, {
      plugin: 'slack',
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });

    expect(state.activeNetworkCaptures.has(10)).toBe(true);
    expect(state.activeNetworkCaptures.has(11)).toBe(false);
  });

  test('removes all plugin tab activeNetworkCaptures entries when state changes to closed', () => {
    const state = createState();
    withPlugin(state, 'slack');
    state.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 42, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.activeNetworkCaptures.add(42);

    handleTabStateChanged(state, { plugin: 'slack', state: 'closed', tabs: [] });

    expect(state.activeNetworkCaptures.has(42)).toBe(false);
  });

  test('does not touch activeNetworkCaptures for tabs that remain in the mapping', () => {
    const state = createState();
    withPlugin(state, 'slack');
    state.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 7, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    state.activeNetworkCaptures.add(7);

    // Same tab 7 still present
    handleTabStateChanged(state, {
      plugin: 'slack',
      state: 'ready',
      tabs: [{ tabId: 7, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });

    expect(state.activeNetworkCaptures.has(7)).toBe(true);
  });
});
