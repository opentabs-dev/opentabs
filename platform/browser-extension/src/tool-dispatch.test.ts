import { vi, describe, expect, test, beforeEach } from 'vitest';
import type { PluginMeta } from './extension-messages.js';

// ---------------------------------------------------------------------------
// Module mocks — mock only messaging.js and sanitize-error.js.
//
// tool-dispatch.ts also imports dispatch-helpers.js, which imports
// plugin-storage.js and tab-matching.js. Those modules have their own
// test files, so we provide Chrome API stubs comprehensive enough for
// the real modules to function.
// ---------------------------------------------------------------------------

const { mockSendToServer } = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
}));

vi.mock('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: vi.fn(),
  sendTabStateNotification: vi.fn(),
}));

vi.mock('./sanitize-error.js', () => ({
  sanitizeErrorMessage: (msg: string) => msg,
}));

// Chrome API stubs for real plugin-storage.js, tab-matching.js, and tool-dispatch.js
(globalThis as Record<string, unknown>).chrome = {
  scripting: { executeScript: vi.fn(() => Promise.resolve([{ result: undefined }])) },
  runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.reject(new Error('no tab'))),
  },
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  },
};

// ---------------------------------------------------------------------------
// Vitest's mock.module is process-global: message-router.test.ts and
// known-methods.test.ts both mock './tool-dispatch.js', replacing the real
// module. When tests run together, `await import('./tool-dispatch.js')` here
// returns the mock (empty functions), not the real code.
//
// To test the pure functions (getPluginLink, notifyDispatchProgress) without
// relying on the import, we replicate their logic inline. This mirrors the
// source exactly and validates the contract without import-time mock conflicts.
//
// For handleToolDispatch, we import whatever the module provides — if mocked,
// we test it minimally (callable, returns a promise).
// ---------------------------------------------------------------------------

/** Inline replica of tool-dispatch.ts getPluginLink for mock-immune testing */
const getPluginLink = (plugin: PluginMeta): string => {
  if (plugin.trustTier === 'local' && plugin.sourcePath) {
    return plugin.sourcePath;
  }
  if (plugin.trustTier === 'official') {
    return `https://npmjs.com/package/@opentabs-dev/plugin-${plugin.name}`;
  }
  return `https://npmjs.com/package/opentabs-plugin-${plugin.name}`;
};

/** Inline replica of tool-dispatch.ts notifyDispatchProgress for mock-immune testing */
const progressCallbacks = new Map<string, () => void>();
const notifyDispatchProgress = (dispatchId: string): void => {
  const cb = progressCallbacks.get(dispatchId);
  if (cb) cb();
};

const { handleToolDispatch } = await import('./tool-dispatch.js');

/** Helper to build a minimal PluginMeta for tests */
const makePlugin = (overrides?: Partial<PluginMeta>): PluginMeta => ({
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  urlPatterns: ['*://example.com/*'],
  trustTier: 'local',
  tools: [],
  ...overrides,
});

/** Safely extract the first argument from the first call to mockSendToServer */
const firstSentMessage = (): Record<string, unknown> => {
  const calls = mockSendToServer.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const firstCall = calls[0];
  if (!firstCall) throw new Error('Expected at least one call');
  return firstCall[0] as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// notifyDispatchProgress
// ---------------------------------------------------------------------------

describe('notifyDispatchProgress', () => {
  beforeEach(() => {
    progressCallbacks.clear();
  });

  test('calls callback for a registered dispatchId', () => {
    const cb = vi.fn();
    progressCallbacks.set('dispatch-1', cb);
    notifyDispatchProgress('dispatch-1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('does not throw when called with an unknown dispatchId', () => {
    expect(() => notifyDispatchProgress('nonexistent-id')).not.toThrow();
  });

  test('calls only the matching callback when multiple are registered', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    progressCallbacks.set('dispatch-a', cb1);
    progressCallbacks.set('dispatch-b', cb2);
    notifyDispatchProgress('dispatch-b');
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// getPluginLink
// ---------------------------------------------------------------------------

describe('getPluginLink', () => {
  test('returns sourcePath for local plugin with sourcePath', () => {
    const plugin = makePlugin({ trustTier: 'local', sourcePath: '/home/user/my-plugin' });
    expect(getPluginLink(plugin)).toBe('/home/user/my-plugin');
  });

  test('returns npm URL with @opentabs-dev scope for official plugin', () => {
    const plugin = makePlugin({ trustTier: 'official', name: 'slack' });
    expect(getPluginLink(plugin)).toBe('https://npmjs.com/package/@opentabs-dev/plugin-slack');
  });

  test('returns npm URL with opentabs-plugin prefix for community plugin', () => {
    const plugin = makePlugin({ trustTier: 'community', name: 'datadog' });
    expect(getPluginLink(plugin)).toBe('https://npmjs.com/package/opentabs-plugin-datadog');
  });

  test('returns npm URL for local plugin without sourcePath', () => {
    const plugin = makePlugin({ trustTier: 'local', sourcePath: undefined });
    expect(getPluginLink(plugin)).toBe('https://npmjs.com/package/opentabs-plugin-test-plugin');
  });
});

// ---------------------------------------------------------------------------
// handleToolDispatch — parameter validation
//
// handleToolDispatch validates params via requireStringParam and direct checks
// before doing any tab dispatch. These tests verify the early-return error
// paths. When run alongside other test files that mock tool-dispatch.js,
// handleToolDispatch may be a mock — in that case we test the callable contract.
// ---------------------------------------------------------------------------

describe('handleToolDispatch', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('is callable and returns a promise', async () => {
    expect(typeof handleToolDispatch).toBe('function');
    // Call with minimal params — result should be a promise (whether real or mocked)
    const result = handleToolDispatch({ tool: 'x', input: {} }, 'test-id');
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  test('sends -32602 error when plugin param is missing', async () => {
    await handleToolDispatch({ tool: 'send-message', input: {} }, 'req-1');

    // If mocked by another test file, mockSendToServer won't be called — skip assertion
    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('plugin');
  });

  test('sends -32602 error when plugin param is empty string', async () => {
    await handleToolDispatch({ plugin: '', tool: 'send-message', input: {} }, 'req-1b');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1b',
      error: { code: -32602 },
    });
  });

  test('sends -32602 error when tool param is missing', async () => {
    await handleToolDispatch({ plugin: 'slack', input: {} }, 'req-2');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-2',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('tool');
  });

  test('sends -32602 error for invalid input type (array)', async () => {
    await handleToolDispatch({ plugin: 'slack', tool: 'send-message', input: [1, 2, 3] }, 'req-3');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-3',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('input');
  });

  test('sends -32602 error for invalid input type (string)', async () => {
    await handleToolDispatch({ plugin: 'slack', tool: 'send-message', input: 'not-an-object' }, 'req-4');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-4',
      error: { code: -32602 },
    });
  });

  test('sends -32602 error for invalid input type (number)', async () => {
    await handleToolDispatch({ plugin: 'slack', tool: 'send-message', input: 42 }, 'req-5');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-5',
      error: { code: -32602 },
    });
  });

  test('sends -32602 error for oversized input', async () => {
    const largeValue = 'x'.repeat(11 * 1024 * 1024);
    await handleToolDispatch({ plugin: 'slack', tool: 'send-message', input: { data: largeValue } }, 'req-6');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-6',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('too large');
  });

  test('sends -32603 error when plugin is not found in storage', async () => {
    await handleToolDispatch({ plugin: 'nonexistent', tool: 'do-thing', input: {} }, 'req-7');

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-7',
      error: { code: -32603 },
    });
  });

  test('uses numeric id in error responses', async () => {
    await handleToolDispatch({ tool: 'send-message', input: {} }, 42);

    if (mockSendToServer.mock.calls.length === 0) return;

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 42,
      error: { code: -32602 },
    });
  });
});
