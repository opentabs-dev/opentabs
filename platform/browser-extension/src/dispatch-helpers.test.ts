import { mock, describe, expect, test, beforeEach } from 'bun:test';
import type { DispatchResult } from './dispatch-helpers.js';
import type { PluginMeta } from './extension-messages.js';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing dispatch-helpers.ts so that
// the exported functions bind to the mocked versions of dependencies.
// ---------------------------------------------------------------------------

const mockSendToServer = mock<(data: unknown) => void>();
const mockGetPluginMeta = mock<(name: string) => Promise<PluginMeta | null>>();
const mockFindAllMatchingTabs = mock<(plugin: PluginMeta) => Promise<chrome.tabs.Tab[]>>();
const mockUrlMatchesPatterns = mock<(url: string, patterns: string[]) => boolean>();

await mock.module('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: mock(),
}));

await mock.module('./plugin-storage.js', () => ({
  storePluginsBatch: mock(),
  removePlugin: mock(),
  removePluginsBatch: mock(),
  getAllPluginMeta: mock(),
  getPluginMeta: mockGetPluginMeta,
  invalidatePluginCache: mock(),
}));

await mock.module('./tab-matching.js', () => ({
  findAllMatchingTabs: mockFindAllMatchingTabs,
  urlMatchesPatterns: mockUrlMatchesPatterns,
  matchPattern: mock(),
  findMatchingTab: mock(),
}));

await mock.module('./sanitize-error.js', () => ({
  sanitizeErrorMessage: (msg: string) => msg,
}));

// Chrome API stubs
const mockTabsGet = mock<(tabId: number) => Promise<chrome.tabs.Tab>>();
(globalThis as Record<string, unknown>).chrome = {
  tabs: { get: mockTabsGet },
};

// Import after mocking
const { requireStringParam, resolvePlugin, isAdapterNotReady, dispatchWithTabFallback } =
  await import('./dispatch-helpers.js');

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
// requireStringParam
// ---------------------------------------------------------------------------

describe('requireStringParam', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('returns the value for a valid non-empty string', () => {
    const result = requireStringParam({ name: 'slack' }, 'name', 'req-1');
    expect(result).toBe('slack');
    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('returns null and sends -32602 error for missing param', () => {
    const result = requireStringParam({}, 'name', 'req-2');
    expect(result).toBeNull();
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-2',
      error: { code: -32602 },
    });
  });

  test('returns null and sends -32602 error for empty string', () => {
    const result = requireStringParam({ name: '' }, 'name', 'req-3');
    expect(result).toBeNull();
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-3',
      error: { code: -32602 },
    });
  });

  test('returns null and sends -32602 error for non-string value', () => {
    const result = requireStringParam({ name: 42 }, 'name', 'req-4');
    expect(result).toBeNull();
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-4',
      error: { code: -32602 },
    });
  });

  test('error message includes the param name', () => {
    requireStringParam({ plugin: null }, 'plugin', 'req-5');
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('plugin');
  });
});

// ---------------------------------------------------------------------------
// resolvePlugin
// ---------------------------------------------------------------------------

describe('resolvePlugin', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockGetPluginMeta.mockReset();
  });

  test('returns plugin metadata when found', async () => {
    const plugin = makePlugin();
    mockGetPluginMeta.mockResolvedValue(plugin);

    const result = await resolvePlugin('test-plugin', 'req-10');
    expect(result).toBe(plugin);
    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('returns null and sends -32603 error when plugin not found', async () => {
    mockGetPluginMeta.mockResolvedValue(null);

    const result = await resolvePlugin('nonexistent', 'req-11');
    expect(result).toBeNull();
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-11',
      error: { code: -32603 },
    });
  });

  test('error message includes the plugin name', async () => {
    mockGetPluginMeta.mockResolvedValue(null);

    await resolvePlugin('missing-plugin', 'req-12');
    const msg = firstSentMessage() as { error: { message: string } };
    expect(msg.error.message).toContain('missing-plugin');
  });
});

// ---------------------------------------------------------------------------
// isAdapterNotReady
// ---------------------------------------------------------------------------

describe('isAdapterNotReady', () => {
  test('returns true for error result with code -32002', () => {
    expect(isAdapterNotReady({ type: 'error', code: -32002, message: 'Not ready' })).toBe(true);
  });

  test('returns false for success result', () => {
    expect(isAdapterNotReady({ type: 'success', output: 'ok' })).toBe(false);
  });

  test('returns false for error result with different code', () => {
    expect(isAdapterNotReady({ type: 'error', code: -32603, message: 'Other error' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dispatchWithTabFallback
// ---------------------------------------------------------------------------

describe('dispatchWithTabFallback', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockFindAllMatchingTabs.mockReset();
    mockUrlMatchesPatterns.mockReset();
    mockTabsGet.mockReset();
  });

  const plugin = makePlugin();

  test('sends -32001 error when no matching tabs', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([]);

    await dispatchWithTabFallback({
      id: 'req-20',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab: mock(),
    });

    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-20',
      error: { code: -32001 },
    });
  });

  test('calls executeOnTab for matching tab and sends success result', async () => {
    const tab = { id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab]);
    mockTabsGet.mockResolvedValue(tab);
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockResolvedValue({ type: 'success', output: { data: 'result' } });

    await dispatchWithTabFallback({
      id: 'req-21',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(1);
    expect(executeOnTab).toHaveBeenCalledWith(1);
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-21',
      result: { output: { data: 'result' } },
    });
  });

  test('falls back to next tab on adapter-not-ready error', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);
    mockTabsGet.mockImplementation(tabId =>
      Promise.resolve({ id: tabId, url: `https://example.com/${tabId}` } as chrome.tabs.Tab),
    );
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockImplementation(tabId => {
      if (tabId === 1) return Promise.resolve({ type: 'error', code: -32002, message: 'Adapter not ready' });
      return Promise.resolve({ type: 'success', output: 'ok' });
    });

    await dispatchWithTabFallback({
      id: 'req-22',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(2);
    expect(executeOnTab).toHaveBeenCalledWith(1);
    expect(executeOnTab).toHaveBeenCalledWith(2);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-22',
      result: { output: 'ok' },
    });
  });

  test('falls back to next tab on tab-gone error', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);
    mockTabsGet.mockImplementation(tabId =>
      Promise.resolve({ id: tabId, url: `https://example.com/${tabId}` } as chrome.tabs.Tab),
    );
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockImplementation(tabId => {
      if (tabId === 1) return Promise.reject(new Error('No tab with id: 1'));
      return Promise.resolve({ type: 'success', output: 'recovered' });
    });

    await dispatchWithTabFallback({
      id: 'req-23',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'resource read',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(2);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-23',
      result: { output: 'recovered' },
    });
  });

  test('sends first error when all tabs fail', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);
    mockTabsGet.mockImplementation(tabId =>
      Promise.resolve({ id: tabId, url: `https://example.com/${tabId}` } as chrome.tabs.Tab),
    );
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockResolvedValue({ type: 'error', code: -32002, message: 'Adapter not ready' });

    await dispatchWithTabFallback({
      id: 'req-24',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'prompt get',
      executeOnTab,
    });

    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-24',
      error: { code: -32002, message: 'Adapter not ready' },
    });
  });

  test('sends -32001 for tabs with undefined IDs', async () => {
    const tab = { url: 'https://example.com/page' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab]);

    await dispatchWithTabFallback({
      id: 'req-25',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab: mock(),
    });

    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-25',
      error: { code: -32001 },
    });
  });

  test('skips tab when TOCTOU recheck shows URL no longer matches', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);

    mockTabsGet.mockImplementation(tabId => {
      if (tabId === 1) return Promise.resolve({ id: 1, url: 'https://other.com/page' } as chrome.tabs.Tab);
      return Promise.resolve({ id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab);
    });
    mockUrlMatchesPatterns.mockImplementation(url => url.includes('example.com'));

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockResolvedValue({ type: 'success', output: 'ok' });

    await dispatchWithTabFallback({
      id: 'req-26',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(1);
    expect(executeOnTab).toHaveBeenCalledWith(2);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-26',
      result: { output: 'ok' },
    });
  });

  test('skips tab when chrome.tabs.get throws (tab closed during TOCTOU)', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);

    mockTabsGet.mockImplementation(tabId => {
      if (tabId === 1) return Promise.reject(new Error('No tab with id: 1'));
      return Promise.resolve({ id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab);
    });
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockResolvedValue({ type: 'success', output: 'ok' });

    await dispatchWithTabFallback({
      id: 'req-27',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'resource read',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(1);
    expect(executeOnTab).toHaveBeenCalledWith(2);
  });

  test('sends non-adapter error immediately without fallback', async () => {
    const tab1 = { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab;
    const tab2 = { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab;
    mockFindAllMatchingTabs.mockResolvedValue([tab1, tab2]);
    mockTabsGet.mockImplementation(tabId =>
      Promise.resolve({ id: tabId, url: `https://example.com/${tabId}` } as chrome.tabs.Tab),
    );
    mockUrlMatchesPatterns.mockReturnValue(true);

    const executeOnTab = mock<(tabId: number) => Promise<DispatchResult>>();
    executeOnTab.mockResolvedValue({ type: 'error', code: -32603, message: 'Internal error' });

    await dispatchWithTabFallback({
      id: 'req-28',
      pluginName: 'test-plugin',
      plugin,
      operationName: 'tool dispatch',
      executeOnTab,
    });

    expect(executeOnTab).toHaveBeenCalledTimes(1);
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-28',
      error: { code: -32603, message: 'Internal error' },
    });
  });
});
