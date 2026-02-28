import { vi, describe, expect, test, beforeEach } from 'vitest';
import type { PluginMeta } from './extension-messages.js';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing tab-state.ts so that the exported
// functions bind to the mocked versions of dependencies.
// ---------------------------------------------------------------------------

const {
  mockSendToServer,
  mockForwardToSidePanel,
  mockSendTabStateNotification,
  mockGetAllPluginMeta,
  mockFindAllMatchingTabs,
  mockUrlMatchesPatterns,
} = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
  mockForwardToSidePanel: vi.fn<(data: unknown) => void>(),
  mockSendTabStateNotification: vi.fn<(pluginName: string, stateInfo: unknown) => void>(),
  mockGetAllPluginMeta: vi.fn<() => Promise<Record<string, PluginMeta>>>(),
  mockFindAllMatchingTabs: vi.fn<(plugin: PluginMeta) => Promise<chrome.tabs.Tab[]>>(),
  mockUrlMatchesPatterns: vi.fn<(url: string, patterns: string[]) => boolean>(),
}));

vi.mock('./constants.js', () => ({
  IS_READY_TIMEOUT_MS: 100,
}));

vi.mock('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: mockForwardToSidePanel,
  sendTabStateNotification: mockSendTabStateNotification,
}));

vi.mock('./plugin-storage.js', () => ({
  storePluginsBatch: vi.fn(),
  removePlugin: vi.fn(),
  removePluginsBatch: vi.fn(),
  getAllPluginMeta: mockGetAllPluginMeta,
  getPluginMeta: vi.fn(),
  invalidatePluginCache: vi.fn(),
}));

vi.mock('./tab-matching.js', () => ({
  findAllMatchingTabs: mockFindAllMatchingTabs,
  urlMatchesPatterns: mockUrlMatchesPatterns,
  matchPattern: vi.fn(),
  findMatchingTab: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Chrome API stubs
// ---------------------------------------------------------------------------

const mockExecuteScript = vi.fn<(injection: unknown) => Promise<Array<{ result?: unknown }>>>();
const mockTabsGet = vi.fn<(tabId: number) => Promise<chrome.tabs.Tab>>();

(globalThis as Record<string, unknown>).chrome = {
  scripting: { executeScript: mockExecuteScript },
  tabs: { get: mockTabsGet },
};

// Import after mocking
const {
  computePluginTabState,
  clearTabStateCache,
  clearPluginTabState,
  updateLastKnownState,
  getLastKnownStates,
  checkTabRemoved,
  checkTabChanged,
  sendTabSyncAll,
} = await import('./tab-state.js');

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

// ---------------------------------------------------------------------------
// computePluginTabState
// ---------------------------------------------------------------------------

describe('computePluginTabState', () => {
  beforeEach(() => {
    mockFindAllMatchingTabs.mockReset();
    mockExecuteScript.mockReset();
  });

  test('returns closed when no matching tabs exist', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([]);

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'closed', tabId: null, url: null });
  });

  test('returns ready when adapter isReady returns true', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'ready', tabId: 1, url: 'https://example.com/page' });
  });

  test('returns unavailable when adapter isReady returns false', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 2, url: 'https://example.com/other' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'unavailable', tabId: 2, url: 'https://example.com/other' });
  });

  test('returns unavailable when executeScript throws', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 3, url: 'https://example.com/error' } as chrome.tabs.Tab]);
    mockExecuteScript.mockRejectedValue(new Error('Tab crashed'));

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'unavailable', tabId: 3, url: 'https://example.com/error' });
  });

  test('skips tabs with undefined id', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { url: 'https://example.com/no-id' } as chrome.tabs.Tab,
      { id: 5, url: 'https://example.com/has-id' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'ready', tabId: 5, url: 'https://example.com/has-id' });
  });

  test('returns ready for first ready tab among multiple', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 10, url: 'https://example.com/a' } as chrome.tabs.Tab,
      { id: 11, url: 'https://example.com/b' } as chrome.tabs.Tab,
    ]);
    let callCount = 0;
    mockExecuteScript.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ result: false }]);
      return Promise.resolve([{ result: true }]);
    });

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'ready', tabId: 11, url: 'https://example.com/b' });
  });

  test('returns unavailable with fallback tab url when none are ready', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 20, url: 'https://example.com/first' } as chrome.tabs.Tab,
      { id: 21, url: 'https://example.com/second' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('unavailable');
    expect(result.tabId).toBe(20);
    expect(result.url).toBe('https://example.com/first');
  });

  test('returns unavailable with null url when tab url is undefined', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 30 } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result).toEqual({ state: 'unavailable', tabId: 30, url: null });
  });
});

// ---------------------------------------------------------------------------
// lastKnownState cache — updateLastKnownState, getLastKnownStates,
// clearTabStateCache, clearPluginTabState
// ---------------------------------------------------------------------------

describe('lastKnownState cache', () => {
  beforeEach(() => {
    clearTabStateCache();
  });

  test('getLastKnownStates returns empty map initially', () => {
    expect(getLastKnownStates().size).toBe(0);
  });

  test('updateLastKnownState populates the cache', async () => {
    await updateLastKnownState('my-plugin', 'ready');
    expect(getLastKnownStates().get('my-plugin')).toBe('ready');
  });

  test('updateLastKnownState overwrites previous value', async () => {
    await updateLastKnownState('my-plugin', 'ready');
    await updateLastKnownState('my-plugin', 'closed');
    expect(getLastKnownStates().get('my-plugin')).toBe('closed');
  });

  test('clearTabStateCache clears all entries', async () => {
    await updateLastKnownState('alpha', 'ready');
    await updateLastKnownState('beta', 'unavailable');
    clearTabStateCache();
    expect(getLastKnownStates().size).toBe(0);
  });

  test('clearPluginTabState removes a single plugin entry', async () => {
    await updateLastKnownState('alpha', 'ready');
    await updateLastKnownState('beta', 'unavailable');
    clearPluginTabState('alpha');
    expect(getLastKnownStates().has('alpha')).toBe(false);
    expect(getLastKnownStates().get('beta')).toBe('unavailable');
  });

  test('clearPluginTabState is a no-op for unknown plugins', () => {
    clearPluginTabState('nonexistent');
    expect(getLastKnownStates().size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// withPluginLock — chain-breaking and serialization
// ---------------------------------------------------------------------------

describe('withPluginLock (via updateLastKnownState)', () => {
  beforeEach(() => {
    clearTabStateCache();
  });

  test('many sequential operations complete successfully without chain growth', async () => {
    // Run enough operations that an unbounded chain would be observable as a
    // slowdown or stack overflow; verifies chain-breaking does not break correctness.
    for (let i = 0; i < 100; i++) {
      await updateLastKnownState('my-plugin', i % 2 === 0 ? 'ready' : 'closed');
    }
    // 100th iteration (i=99, odd) sets 'closed'
    expect(getLastKnownStates().get('my-plugin')).toBe('closed');
  });

  test('concurrent operations for the same plugin serialize correctly', async () => {
    const executionOrder: string[] = [];

    // We use notifyAffectedPlugins indirectly via checkTabRemoved with a
    // delayed mock to verify serialization. Instead, we use the fact that
    // concurrent updateLastKnownState calls should produce a deterministic
    // final state because they execute in queue order.
    const updates = ['ready', 'unavailable', 'closed', 'ready', 'unavailable'] as const;
    // Launch all without awaiting — they should serialize via the lock
    const promises = updates.map((state, i) => {
      executionOrder.push(`start-${i}`);
      return updateLastKnownState('plugin-a', state);
    });
    await Promise.all(promises);

    // All operations started before any completed (concurrent launch)
    expect(executionOrder).toEqual(['start-0', 'start-1', 'start-2', 'start-3', 'start-4']);
    // Final state is the last enqueued update
    expect(getLastKnownStates().get('plugin-a')).toBe('unavailable');
  });

  test('concurrent operations for different plugins run independently', async () => {
    const promises = [
      updateLastKnownState('alpha', 'ready'),
      updateLastKnownState('beta', 'closed'),
      updateLastKnownState('alpha', 'closed'),
      updateLastKnownState('beta', 'ready'),
    ];
    await Promise.all(promises);

    // Each plugin's last queued state wins
    expect(getLastKnownStates().get('alpha')).toBe('closed');
    expect(getLastKnownStates().get('beta')).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// checkTabRemoved
// ---------------------------------------------------------------------------

describe('checkTabRemoved', () => {
  beforeEach(() => {
    clearTabStateCache();
    mockGetAllPluginMeta.mockReset();
    mockFindAllMatchingTabs.mockReset();
    mockExecuteScript.mockReset();
    mockSendTabStateNotification.mockReset();
  });

  test('does nothing when no plugins are stored', async () => {
    mockGetAllPluginMeta.mockResolvedValue({});
    await checkTabRemoved(1);
    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('sends notification when tab removal changes plugin state', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    // The plugin was previously ready, now after tab removal it computes as closed
    await updateLastKnownState('slack', 'ready');

    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabRemoved(1);

    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'closed',
      tabId: null,
      url: null,
    });
  });

  test('suppresses notification when state has not changed', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    await updateLastKnownState('slack', 'closed');
    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabRemoved(1);

    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('checks all plugins on tab removal', async () => {
    const pluginA = makePlugin({ name: 'alpha' });
    const pluginB = makePlugin({ name: 'beta' });
    mockGetAllPluginMeta.mockResolvedValue({ alpha: pluginA, beta: pluginB });

    await updateLastKnownState('alpha', 'ready');
    await updateLastKnownState('beta', 'ready');

    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabRemoved(1);

    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// checkTabChanged
// ---------------------------------------------------------------------------

describe('checkTabChanged', () => {
  beforeEach(() => {
    clearTabStateCache();
    mockGetAllPluginMeta.mockReset();
    mockFindAllMatchingTabs.mockReset();
    mockExecuteScript.mockReset();
    mockUrlMatchesPatterns.mockReset();
    mockTabsGet.mockReset();
    mockSendTabStateNotification.mockReset();
  });

  test('does nothing when no plugins are stored', async () => {
    mockGetAllPluginMeta.mockResolvedValue({});
    await checkTabChanged(1, { url: 'https://example.com/' } as chrome.tabs.OnUpdatedInfo);
    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('checks affected plugins on URL change', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    mockUrlMatchesPatterns.mockReturnValue(true);

    // Transition from no state to ready
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await checkTabChanged(1, { url: 'https://example.com/page' } as chrome.tabs.OnUpdatedInfo);

    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'ready',
      tabId: 1,
      url: 'https://example.com/page',
    });
  });

  test('does nothing when changeInfo has neither url nor status=complete', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    await checkTabChanged(1, { title: 'New Title' } as chrome.tabs.OnUpdatedInfo);

    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
    expect(mockFindAllMatchingTabs).not.toHaveBeenCalled();
  });

  test('checks plugins on status=complete by fetching tab URL', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    mockTabsGet.mockResolvedValue({
      id: 1,
      url: 'https://example.com/loaded',
    } as chrome.tabs.Tab);
    mockUrlMatchesPatterns.mockReturnValue(true);

    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com/loaded' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await checkTabChanged(1, { status: 'complete' } as chrome.tabs.OnUpdatedInfo);

    expect(mockTabsGet).toHaveBeenCalledWith(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
  });

  test('returns early when tab.get fails on status=complete', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    mockTabsGet.mockRejectedValue(new Error('Tab closed'));

    await checkTabChanged(1, { status: 'complete' } as chrome.tabs.OnUpdatedInfo);

    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('suppresses notification when state has not changed', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    mockUrlMatchesPatterns.mockReturnValue(true);

    await updateLastKnownState('slack', 'ready');

    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await checkTabChanged(1, { url: 'https://example.com/page' } as chrome.tabs.OnUpdatedInfo);

    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('includes active-state plugins on URL change for closed detection', async () => {
    const activePlugin = makePlugin({ name: 'active-plugin' });
    const closedPlugin = makePlugin({ name: 'closed-plugin' });
    mockGetAllPluginMeta.mockResolvedValue({
      'active-plugin': activePlugin,
      'closed-plugin': closedPlugin,
    });

    // active-plugin was ready, closed-plugin was already closed
    await updateLastKnownState('active-plugin', 'ready');
    await updateLastKnownState('closed-plugin', 'closed');

    // Neither plugin's URL patterns match the new URL
    mockUrlMatchesPatterns.mockReturnValue(false);

    // active-plugin should still be checked because it's not 'closed'
    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabChanged(1, { url: 'https://other.com/page' } as chrome.tabs.OnUpdatedInfo);

    // active-plugin transitions from ready→closed, closed-plugin stays closed (not checked)
    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('active-plugin', {
      state: 'closed',
      tabId: null,
      url: null,
    });
  });
});

// ---------------------------------------------------------------------------
// sendTabSyncAll
// ---------------------------------------------------------------------------

describe('sendTabSyncAll', () => {
  beforeEach(() => {
    clearTabStateCache();
    mockGetAllPluginMeta.mockReset();
    mockFindAllMatchingTabs.mockReset();
    mockExecuteScript.mockReset();
    mockSendToServer.mockReset();
    mockForwardToSidePanel.mockReset();
  });

  test('does nothing when no plugins are stored', async () => {
    mockGetAllPluginMeta.mockResolvedValue({});
    await sendTabSyncAll();
    expect(mockSendToServer).not.toHaveBeenCalled();
    expect(mockForwardToSidePanel).not.toHaveBeenCalled();
  });

  test('sends tab.syncAll with computed states and populates cache', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com/page' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await sendTabSyncAll();

    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentData).toMatchObject({
      jsonrpc: '2.0',
      method: 'tab.syncAll',
    });
    const params = sentData.params as { tabs: Record<string, unknown> };
    expect(params.tabs.slack).toMatchObject({ state: 'ready', tabId: 1 });

    // Verify cache was populated
    expect(getLastKnownStates().get('slack')).toBe('ready');

    // Verify side panel was notified
    expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
  });
});
