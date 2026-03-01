import { vi, describe, expect, test, beforeEach } from 'vitest';
import type { PluginMeta } from './extension-messages.js';

// ---------------------------------------------------------------------------
// Module mocks — mirror tool-dispatch.test.ts pattern.
//
// Mock only messaging.js and sanitize-error.js. The real dispatch-helpers.js,
// plugin-storage.js, and tab-matching.js run with Chrome API stubs.
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

// Chrome API stubs for real plugin-storage.js, tab-matching.js, dispatch-helpers.js
const mockExecuteScript = vi.fn<() => Promise<Array<{ result: unknown }>>>();
const mockTabsQuery = vi.fn<() => Promise<chrome.tabs.Tab[]>>();
const mockTabsGet = vi.fn<() => Promise<chrome.tabs.Tab>>();
const mockStorageLocalGet = vi.fn<() => Promise<Record<string, unknown>>>();
const mockStorageLocalSet = vi.fn<() => Promise<void>>();

(globalThis as Record<string, unknown>).chrome = {
  scripting: { executeScript: mockExecuteScript },
  runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
  },
  storage: {
    local: {
      get: mockStorageLocalGet,
      set: mockStorageLocalSet,
    },
  },
};

const { handleResourceRead, handlePromptGet } = await import('./resource-prompt-dispatch.js');
const { invalidatePluginCache } = await import('./plugin-storage.js');

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

/** Set up plugin in storage and a matching tab for dispatch tests */
const setupPluginAndTab = (
  plugin: PluginMeta = makePlugin(),
  tabId = 100,
  tabUrl = 'https://example.com/page',
): void => {
  const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
  mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
  mockTabsQuery.mockResolvedValue([{ id: tabId, url: tabUrl } as chrome.tabs.Tab]);
  mockTabsGet.mockResolvedValue({ id: tabId, url: tabUrl } as chrome.tabs.Tab);
};

// ---------------------------------------------------------------------------
// handleResourceRead
// ---------------------------------------------------------------------------

describe('handleResourceRead', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
    mockTabsQuery.mockReset();
    mockTabsGet.mockReset();
    mockStorageLocalGet.mockReset();
    mockStorageLocalSet.mockReset();
    invalidatePluginCache();
    // Default: no plugins in storage
    mockStorageLocalGet.mockResolvedValue({});
  });

  test('sends -32602 error when plugin param is missing', async () => {
    await handleResourceRead({ uri: 'opentabs+test://resource' }, 'req-1');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('plugin');
  });

  test('sends -32602 error when uri param is missing', async () => {
    await handleResourceRead({ plugin: 'test-plugin' }, 'req-2');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-2',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('uri');
  });

  test('sends -32602 error when plugin param is empty string', async () => {
    await handleResourceRead({ plugin: '', uri: 'opentabs+test://resource' }, 'req-3');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-3',
      error: { code: -32602 },
    });
  });

  test('sends -32603 error when plugin is not found in storage', async () => {
    await handleResourceRead({ plugin: 'nonexistent', uri: 'opentabs+test://resource' }, 'req-4');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-4',
      error: { code: -32603 },
    });
  });

  test('dispatches resource read to matching tab and returns success', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    mockExecuteScript.mockResolvedValue([
      { result: { type: 'success', output: { uri: 'test://r', text: 'content' } } },
    ]);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource' }, 'req-5');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-5',
      result: { output: { uri: 'test://r', text: 'content' } },
    });
  });

  test('returns adapter integrity error from executeScript', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    mockExecuteScript.mockResolvedValue([
      {
        result: {
          type: 'error',
          code: -32002,
          message: 'Adapter "test-plugin" failed integrity check (not frozen)',
        },
      },
    ]);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource' }, 'req-6');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-6',
      error: {
        code: -32002,
        message: 'Adapter "test-plugin" failed integrity check (not frozen)',
      },
    });
  });

  test('returns error when resource URI not found in adapter', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    mockExecuteScript.mockResolvedValue([
      {
        result: {
          type: 'error',
          code: -32603,
          message: 'Resource "opentabs+test://missing" not found in adapter "test-plugin"',
        },
      },
    ]);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://missing' }, 'req-7');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-7',
      error: { code: -32603 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('not found');
  });

  test('handles numeric request id', async () => {
    await handleResourceRead({ uri: 'opentabs+test://resource' }, 42);

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 42,
      error: { code: -32602 },
    });
  });

  test('sends no-usable-tab error when no matching tabs exist', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    mockTabsQuery.mockResolvedValue([]);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource' }, 'req-8');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-8',
      error: { code: -32001 },
    });
  });

  test('routes to targeted dispatch when tabId is present', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin, 100, 'https://example.com/page');

    mockExecuteScript.mockResolvedValue([
      { result: { type: 'success', output: { uri: 'test://r', text: 'targeted content' } } },
    ]);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource', tabId: 100 }, 'req-targeted');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-targeted',
      result: { output: { uri: 'test://r', text: 'targeted content' } },
    });
  });

  test('targeted dispatch returns error when tab does not exist', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    mockTabsGet.mockRejectedValue(new Error('No tab with id 999'));

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource', tabId: 999 }, 'req-notfound');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-notfound',
      error: { code: -32001 },
    });
  });

  test('targeted dispatch returns error when tab URL does not match plugin patterns', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    // Tab exists but URL doesn't match plugin's urlPatterns
    mockTabsGet.mockResolvedValue({ id: 200, url: 'https://other-site.com/page' } as chrome.tabs.Tab);

    await handleResourceRead({ plugin: 'test-plugin', uri: 'opentabs+test://resource', tabId: 200 }, 'req-mismatch');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-mismatch',
      error: { code: -32003 },
    });
  });
});

// ---------------------------------------------------------------------------
// handlePromptGet
// ---------------------------------------------------------------------------

describe('handlePromptGet', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
    mockTabsQuery.mockReset();
    mockTabsGet.mockReset();
    mockStorageLocalGet.mockReset();
    mockStorageLocalSet.mockReset();
    invalidatePluginCache();
    // Default: no plugins in storage
    mockStorageLocalGet.mockResolvedValue({});
  });

  test('sends -32602 error when plugin param is missing', async () => {
    await handlePromptGet({ prompt: 'summarize', arguments: {} }, 'req-1');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('plugin');
  });

  test('sends -32602 error when prompt param is missing', async () => {
    await handlePromptGet({ plugin: 'test-plugin', arguments: {} }, 'req-2');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-2',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('prompt');
  });

  test('sends -32602 error when arguments is an array (invalid type)', async () => {
    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', arguments: [1, 2, 3] }, 'req-3');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-3',
      error: { code: -32602 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('arguments');
  });

  test('sends -32602 error when arguments is a string (invalid type)', async () => {
    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', arguments: 'not-an-object' }, 'req-4');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-4',
      error: { code: -32602 },
    });
  });

  test('sends -32603 error when plugin is not found in storage', async () => {
    await handlePromptGet({ plugin: 'nonexistent', prompt: 'summarize' }, 'req-5');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-5',
      error: { code: -32603 },
    });
  });

  test('dispatches prompt render to matching tab and returns success', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    const promptOutput = { messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }] };
    mockExecuteScript.mockResolvedValue([{ result: { type: 'success', output: promptOutput } }]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', arguments: { topic: 'test' } }, 'req-6');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-6',
      result: { output: promptOutput },
    });
  });

  test('returns adapter integrity error from executeScript', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    mockExecuteScript.mockResolvedValue([
      {
        result: {
          type: 'error',
          code: -32002,
          message: 'Adapter "test-plugin" failed integrity check (not frozen)',
        },
      },
    ]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize' }, 'req-7');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-7',
      error: {
        code: -32002,
        message: 'Adapter "test-plugin" failed integrity check (not frozen)',
      },
    });
  });

  test('returns error when prompt not found in adapter', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    mockExecuteScript.mockResolvedValue([
      {
        result: {
          type: 'error',
          code: -32603,
          message: 'Prompt "missing" not found in adapter "test-plugin"',
        },
      },
    ]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'missing' }, 'req-8');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-8',
      error: { code: -32603 },
    });
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('not found');
  });

  test('coerces argument values to strings', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    const promptOutput = { messages: [{ role: 'user', content: { type: 'text', text: 'done' } }] };
    mockExecuteScript.mockResolvedValue([{ result: { type: 'success', output: promptOutput } }]);

    await handlePromptGet(
      { plugin: 'test-plugin', prompt: 'summarize', arguments: { count: 42, flag: true } },
      'req-9',
    );

    // Verify executeScript was called with coerced string arguments
    expect(mockExecuteScript).toHaveBeenCalledTimes(1);
    const scriptCall = mockExecuteScript.mock.calls[0] as unknown as [{ args: unknown[] }];
    const scriptArgs = scriptCall[0].args;
    // args[2] is the promptArgs record — values should be coerced to strings
    expect(scriptArgs[2]).toEqual({ count: '42', flag: 'true' });
  });

  test('handles undefined arguments (defaults to empty object)', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin);

    const promptOutput = { messages: [] };
    mockExecuteScript.mockResolvedValue([{ result: { type: 'success', output: promptOutput } }]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize' }, 'req-10');

    expect(mockExecuteScript).toHaveBeenCalledTimes(1);
    const scriptCall = mockExecuteScript.mock.calls[0] as unknown as [{ args: unknown[] }];
    const scriptArgs = scriptCall[0].args;
    expect(scriptArgs[2]).toEqual({});
  });

  test('handles numeric request id', async () => {
    await handlePromptGet({ prompt: 'summarize' }, 99);

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 99,
      error: { code: -32602 },
    });
  });

  test('sends no-usable-tab error when no matching tabs exist', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    mockTabsQuery.mockResolvedValue([]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize' }, 'req-11');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-11',
      error: { code: -32001 },
    });
  });

  test('routes to targeted dispatch when tabId is present', async () => {
    const plugin = makePlugin();
    setupPluginAndTab(plugin, 100, 'https://example.com/page');

    const promptOutput = { messages: [{ role: 'user', content: { type: 'text', text: 'Targeted' } }] };
    mockExecuteScript.mockResolvedValue([{ result: { type: 'success', output: promptOutput } }]);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', tabId: 100 }, 'req-targeted');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-targeted',
      result: { output: promptOutput },
    });
  });

  test('targeted dispatch returns error when tab does not exist', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    mockTabsGet.mockRejectedValue(new Error('No tab with id 999'));

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', tabId: 999 }, 'req-notfound');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-notfound',
      error: { code: -32001 },
    });
  });

  test('targeted dispatch returns error when tab URL does not match plugin patterns', async () => {
    const plugin = makePlugin();
    const pluginsIndex: Record<string, PluginMeta> = { [plugin.name]: plugin };
    mockStorageLocalGet.mockResolvedValue({ plugins_meta: pluginsIndex });
    mockTabsGet.mockResolvedValue({ id: 200, url: 'https://other-site.com/page' } as chrome.tabs.Tab);

    await handlePromptGet({ plugin: 'test-plugin', prompt: 'summarize', tabId: 200 }, 'req-mismatch');

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-mismatch',
      error: { code: -32003 },
    });
  });
});
