import { vi, describe, expect, test, beforeEach, afterEach } from 'vitest';
import type { PluginMeta, PluginTabStateInfo } from './extension-messages.js';

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
  READINESS_POLL_INTERVAL_MS: 50,
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
const mockStorageSessionSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
const mockStorageSessionGet = vi
  .fn<(keys: string | string[]) => Promise<Record<string, unknown>>>()
  .mockResolvedValue({});
const mockStorageSessionRemove = vi.fn<(keys: string | string[]) => Promise<void>>().mockResolvedValue(undefined);

(globalThis as Record<string, unknown>).chrome = {
  scripting: { executeScript: mockExecuteScript },
  tabs: { get: mockTabsGet },
  storage: {
    session: {
      set: mockStorageSessionSet,
      get: mockStorageSessionGet,
      remove: mockStorageSessionRemove,
    },
  },
};

// Import after mocking
const {
  computePluginTabState,
  clearTabStateCache,
  clearPluginTabState,
  flushLastKnownStateToSession,
  updateLastKnownState,
  getLastKnownStates,
  getAggregateState,
  loadLastKnownStateFromSession,
  checkTabRemoved,
  checkTabChanged,
  sendTabSyncAll,
  startReadinessPoll,
  stopReadinessPoll,
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

/** Helper to build a PluginTabStateInfo for updateLastKnownState calls */
const makeStateInfo = (
  state: 'closed' | 'unavailable' | 'ready',
  tabs: PluginTabStateInfo['tabs'] = [],
): PluginTabStateInfo => ({
  state,
  tabs,
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
    expect(result).toEqual({ state: 'closed', tabs: [] });
  });

  test('returns ready when adapter isReady returns true', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 1, url: 'https://example.com/page', title: 'Page' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('ready');
    expect(result.tabs).toEqual([{ tabId: 1, url: 'https://example.com/page', title: 'Page', ready: true }]);
  });

  test('returns unavailable when adapter isReady returns false', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 2, url: 'https://example.com/other', title: 'Other' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('unavailable');
    expect(result.tabs).toEqual([{ tabId: 2, url: 'https://example.com/other', title: 'Other', ready: false }]);
  });

  test('returns unavailable when executeScript throws', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 3, url: 'https://example.com/error', title: 'Error' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockRejectedValue(new Error('Tab crashed'));

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('unavailable');
    expect(result.tabs).toEqual([{ tabId: 3, url: 'https://example.com/error', title: 'Error', ready: false }]);
  });

  test('skips tabs with undefined id', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { url: 'https://example.com/no-id', title: 'No ID' } as chrome.tabs.Tab,
      { id: 5, url: 'https://example.com/has-id', title: 'Has ID' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('ready');
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toEqual({ tabId: 5, url: 'https://example.com/has-id', title: 'Has ID', ready: true });
  });

  test('probes all tabs and returns full list with per-tab readiness', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 10, url: 'https://example.com/a', title: 'A' } as chrome.tabs.Tab,
      { id: 11, url: 'https://example.com/b', title: 'B' } as chrome.tabs.Tab,
    ]);
    let callCount = 0;
    mockExecuteScript.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([{ result: false }]);
      return Promise.resolve([{ result: true }]);
    });

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('ready');
    expect(result.tabs).toEqual([
      { tabId: 10, url: 'https://example.com/a', title: 'A', ready: false },
      { tabId: 11, url: 'https://example.com/b', title: 'B', ready: true },
    ]);
  });

  test('returns unavailable with all tabs when none are ready', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 20, url: 'https://example.com/first', title: 'First' } as chrome.tabs.Tab,
      { id: 21, url: 'https://example.com/second', title: 'Second' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('unavailable');
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0]).toMatchObject({ tabId: 20, ready: false });
    expect(result.tabs[1]).toMatchObject({ tabId: 21, ready: false });
  });

  test('returns empty url/title when tab properties are undefined', async () => {
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 30 } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    const result = await computePluginTabState(makePlugin());
    expect(result.state).toBe('unavailable');
    expect(result.tabs).toEqual([{ tabId: 30, url: '', title: '', ready: false }]);
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
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    const cached = getLastKnownStates().get('my-plugin');
    expect(cached).toBeDefined();
    expect(getAggregateState(cached ?? '')).toBe('ready');
  });

  test('updateLastKnownState overwrites previous value', async () => {
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    await updateLastKnownState('my-plugin', makeStateInfo('closed'));
    const cached = getLastKnownStates().get('my-plugin');
    expect(getAggregateState(cached ?? '')).toBe('closed');
  });

  test('clearTabStateCache clears all entries', async () => {
    await updateLastKnownState('alpha', makeStateInfo('ready'));
    await updateLastKnownState('beta', makeStateInfo('unavailable'));
    clearTabStateCache();
    expect(getLastKnownStates().size).toBe(0);
  });

  test('clearPluginTabState removes a single plugin entry', async () => {
    await updateLastKnownState('alpha', makeStateInfo('ready'));
    await updateLastKnownState('beta', makeStateInfo('unavailable'));
    clearPluginTabState('alpha');
    expect(getLastKnownStates().has('alpha')).toBe(false);
    const cached = getLastKnownStates().get('beta');
    expect(getAggregateState(cached ?? '')).toBe('unavailable');
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
      await updateLastKnownState('my-plugin', makeStateInfo(i % 2 === 0 ? 'ready' : 'closed'));
    }
    // 100th iteration (i=99, odd) sets 'closed'
    const cached = getLastKnownStates().get('my-plugin');
    expect(getAggregateState(cached ?? '')).toBe('closed');
  });

  test('concurrent operations for the same plugin serialize correctly', async () => {
    const executionOrder: string[] = [];

    const updates = ['ready', 'unavailable', 'closed', 'ready', 'unavailable'] as const;
    // Launch all without awaiting — they should serialize via the lock
    const promises = updates.map((state, i) => {
      executionOrder.push(`start-${i}`);
      return updateLastKnownState('plugin-a', makeStateInfo(state));
    });
    await Promise.all(promises);

    // All operations started before any completed (concurrent launch)
    expect(executionOrder).toEqual(['start-0', 'start-1', 'start-2', 'start-3', 'start-4']);
    // Final state is the last enqueued update
    const cached = getLastKnownStates().get('plugin-a');
    expect(getAggregateState(cached ?? '')).toBe('unavailable');
  });

  test('concurrent operations for different plugins run independently', async () => {
    const promises = [
      updateLastKnownState('alpha', makeStateInfo('ready')),
      updateLastKnownState('beta', makeStateInfo('closed')),
      updateLastKnownState('alpha', makeStateInfo('closed')),
      updateLastKnownState('beta', makeStateInfo('ready')),
    ];
    await Promise.all(promises);

    // Each plugin's last queued state wins
    expect(getAggregateState(getLastKnownStates().get('alpha') ?? '')).toBe('closed');
    expect(getAggregateState(getLastKnownStates().get('beta') ?? '')).toBe('ready');
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
    await updateLastKnownState(
      'slack',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );

    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabRemoved(1);

    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'closed',
      tabs: [],
    });
  });

  test('suppresses notification when state has not changed', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    await updateLastKnownState('slack', makeStateInfo('closed'));
    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabRemoved(1);

    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('checks all plugins on tab removal', async () => {
    const pluginA = makePlugin({ name: 'alpha' });
    const pluginB = makePlugin({ name: 'beta' });
    mockGetAllPluginMeta.mockResolvedValue({ alpha: pluginA, beta: pluginB });

    await updateLastKnownState(
      'alpha',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );
    await updateLastKnownState(
      'beta',
      makeStateInfo('ready', [{ tabId: 2, url: 'https://example.com', title: 'Ex', ready: true }]),
    );

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
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 1, url: 'https://example.com/page', title: 'Page' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await checkTabChanged(1, { url: 'https://example.com/page' } as chrome.tabs.OnUpdatedInfo);

    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com/page', title: 'Page', ready: true }],
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

    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 1, url: 'https://example.com/loaded', title: 'Loaded' } as chrome.tabs.Tab,
    ]);
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

  test('suppresses notification when state and tabs have not changed', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    mockUrlMatchesPatterns.mockReturnValue(true);

    // Pre-populate cache with the same state that will be computed
    await updateLastKnownState(
      'slack',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com/page', title: 'Page', ready: true }]),
    );

    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 1, url: 'https://example.com/page', title: 'Page' } as chrome.tabs.Tab,
    ]);
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
    await updateLastKnownState(
      'active-plugin',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );
    await updateLastKnownState('closed-plugin', makeStateInfo('closed'));

    // Neither plugin's URL patterns match the new URL
    mockUrlMatchesPatterns.mockReturnValue(false);

    // active-plugin should still be checked because it's not 'closed'
    mockFindAllMatchingTabs.mockResolvedValue([]);

    await checkTabChanged(1, { url: 'https://other.com/page' } as chrome.tabs.OnUpdatedInfo);

    // active-plugin transitions from ready→closed, closed-plugin stays closed (not checked)
    expect(mockSendTabStateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('active-plugin', {
      state: 'closed',
      tabs: [],
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
    mockFindAllMatchingTabs.mockResolvedValue([
      { id: 1, url: 'https://example.com/page', title: 'Page' } as chrome.tabs.Tab,
    ]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    await sendTabSyncAll();

    expect(mockSendToServer).toHaveBeenCalledTimes(1);
    const sentData = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentData).toMatchObject({
      jsonrpc: '2.0',
      method: 'tab.syncAll',
    });
    const params = sentData.params as { tabs: Record<string, { state: string; tabs: unknown[] }> };
    expect(params.tabs.slack).toMatchObject({
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com/page', title: 'Page', ready: true }],
    });

    // Verify cache was populated
    const cached = getLastKnownStates().get('slack');
    expect(cached).toBeDefined();
    expect(getAggregateState(cached ?? '')).toBe('ready');

    // Verify side panel was notified
    expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// startReadinessPoll / stopReadinessPoll
// ---------------------------------------------------------------------------

describe('readiness polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopReadinessPoll();
    clearTabStateCache();
    mockGetAllPluginMeta.mockReset();
    mockFindAllMatchingTabs.mockReset();
    mockExecuteScript.mockReset();
    mockSendTabStateNotification.mockReset();
  });

  afterEach(() => {
    stopReadinessPoll();
    vi.useRealTimers();
  });

  test('polls active plugins on interval tick', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    // Pre-populate cache with a ready state
    await updateLastKnownState(
      'slack',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );

    // Plugin now returns unavailable
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Ex' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    startReadinessPoll();

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(50);

    expect(mockGetAllPluginMeta).toHaveBeenCalled();
    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'unavailable',
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: false }],
    });
  });

  test('skips plugins in closed state', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    // Pre-populate cache with a closed state
    await updateLastKnownState('slack', makeStateInfo('closed'));

    startReadinessPoll();

    await vi.advanceTimersByTimeAsync(50);

    // Should not call findAllMatchingTabs because the plugin is closed
    expect(mockFindAllMatchingTabs).not.toHaveBeenCalled();
    expect(mockSendTabStateNotification).not.toHaveBeenCalled();
  });

  test('polls unavailable plugins (may become ready)', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    // Pre-populate cache with unavailable state
    await updateLastKnownState(
      'slack',
      makeStateInfo('unavailable', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: false }]),
    );

    // Plugin now returns ready
    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Ex' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: true }]);

    startReadinessPoll();

    await vi.advanceTimersByTimeAsync(50);

    expect(mockSendTabStateNotification).toHaveBeenCalledWith('slack', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }],
    });
  });

  test('stopReadinessPoll stops the interval', async () => {
    const plugin = makePlugin({ name: 'slack' });
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });

    await updateLastKnownState(
      'slack',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );

    mockFindAllMatchingTabs.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Ex' } as chrome.tabs.Tab]);
    mockExecuteScript.mockResolvedValue([{ result: false }]);

    startReadinessPoll();
    stopReadinessPoll();

    await vi.advanceTimersByTimeAsync(100);

    // No poll should have run after stop
    expect(mockGetAllPluginMeta).not.toHaveBeenCalled();
  });

  test('startReadinessPoll is idempotent', async () => {
    mockGetAllPluginMeta.mockResolvedValue({});

    startReadinessPoll();
    startReadinessPoll();
    startReadinessPoll();

    await vi.advanceTimersByTimeAsync(50);

    // Should only have been called once (one timer, not three)
    expect(mockGetAllPluginMeta).toHaveBeenCalledTimes(1);
  });

  test('does not overlap concurrent poll cycles', async () => {
    const plugin = makePlugin({ name: 'slack' });

    await updateLastKnownState(
      'slack',
      makeStateInfo('ready', [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }]),
    );

    // Make getAllPluginMeta slow so the poll is still running when the next tick fires
    let resolvePluginMeta: (value: Record<string, PluginMeta>) => void = () => {};
    mockGetAllPluginMeta.mockImplementation(
      () =>
        new Promise<Record<string, PluginMeta>>(resolve => {
          resolvePluginMeta = resolve;
        }),
    );

    startReadinessPoll();

    // First tick fires and starts a slow poll
    await vi.advanceTimersByTimeAsync(50);
    expect(mockGetAllPluginMeta).toHaveBeenCalledTimes(1);

    // Second tick fires while the first is still running
    await vi.advanceTimersByTimeAsync(50);
    // Should still only be 1 call because the guard prevented overlap
    expect(mockGetAllPluginMeta).toHaveBeenCalledTimes(1);

    // Resolve the first poll
    resolvePluginMeta({ slack: plugin });
    mockFindAllMatchingTabs.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(0);

    // Third tick should now run since the first poll completed
    mockGetAllPluginMeta.mockResolvedValue({ slack: plugin });
    await vi.advanceTimersByTimeAsync(50);
    expect(mockGetAllPluginMeta).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Session storage persistence — debounced writes
// ---------------------------------------------------------------------------

describe('session storage persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearTabStateCache();
    mockStorageSessionSet.mockClear();
    mockStorageSessionRemove.mockClear();
    mockStorageSessionGet.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('updateLastKnownState does not write to session storage immediately', async () => {
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    expect(mockStorageSessionSet).not.toHaveBeenCalled();
  });

  test('updateLastKnownState writes to session storage after 500ms debounce', async () => {
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    vi.advanceTimersByTime(500);

    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);
    const written = mockStorageSessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toHaveProperty('lastKnownState');
    const stored = written.lastKnownState as Record<string, string>;
    expect(stored['my-plugin']).toBeDefined();
    const parsed = JSON.parse(stored['my-plugin'] ?? '') as { state: string };
    expect(parsed.state).toBe('ready');
  });

  test('rapid updates are coalesced into a single session storage write', async () => {
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    vi.advanceTimersByTime(200);
    await updateLastKnownState('my-plugin', makeStateInfo('unavailable'));
    vi.advanceTimersByTime(200);
    await updateLastKnownState('my-plugin', makeStateInfo('closed'));
    vi.advanceTimersByTime(500);

    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);
    const written = mockStorageSessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    const stored = written.lastKnownState as Record<string, string>;
    const parsed = JSON.parse(stored['my-plugin'] ?? '') as { state: string };
    expect(parsed.state).toBe('closed');
  });

  test('clearTabStateCache cancels pending debounce and removes from session', async () => {
    await updateLastKnownState('my-plugin', makeStateInfo('ready'));
    clearTabStateCache();

    vi.advanceTimersByTime(500);
    expect(mockStorageSessionSet).not.toHaveBeenCalled();

    expect(mockStorageSessionRemove).toHaveBeenCalledWith('lastKnownState');
  });

  test('clearPluginTabState schedules a persist after removal', async () => {
    await updateLastKnownState('alpha', makeStateInfo('ready'));
    await updateLastKnownState('beta', makeStateInfo('unavailable'));
    vi.advanceTimersByTime(500);
    mockStorageSessionSet.mockClear();

    clearPluginTabState('alpha');
    vi.advanceTimersByTime(500);

    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);
    const written = mockStorageSessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    const stored = written.lastKnownState as Record<string, string>;
    expect(stored).not.toHaveProperty('alpha');
    expect(stored).toHaveProperty('beta');
  });

  test('clearPluginTabState does not persist if plugin was not in cache', () => {
    clearPluginTabState('nonexistent');
    vi.advanceTimersByTime(500);
    expect(mockStorageSessionSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Session storage load
// ---------------------------------------------------------------------------

describe('loadLastKnownStateFromSession', () => {
  beforeEach(() => {
    clearTabStateCache();
    mockStorageSessionGet.mockClear();
    mockStorageSessionSet.mockClear();
    mockStorageSessionRemove.mockClear();
  });

  test('populates in-memory Map from session storage', async () => {
    const serializedReady = JSON.stringify({
      state: 'ready',
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Ex', ready: true }],
    });
    const serializedClosed = JSON.stringify({ state: 'closed', tabs: [] });
    mockStorageSessionGet.mockResolvedValue({
      lastKnownState: {
        alpha: serializedReady,
        beta: serializedClosed,
      },
    });

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(2);
    expect(getAggregateState(getLastKnownStates().get('alpha') ?? '')).toBe('ready');
    expect(getAggregateState(getLastKnownStates().get('beta') ?? '')).toBe('closed');
  });

  test('handles empty session storage gracefully', async () => {
    mockStorageSessionGet.mockResolvedValue({});

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(0);
  });

  test('handles session storage read failure gracefully', async () => {
    mockStorageSessionGet.mockRejectedValue(new Error('storage unavailable'));

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(0);
  });

  test('ignores non-string values in stored data', async () => {
    mockStorageSessionGet.mockResolvedValue({
      lastKnownState: {
        valid: JSON.stringify({ state: 'ready', tabs: [] }),
        invalid: 42,
        alsoInvalid: null,
      },
    });

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(1);
    expect(getLastKnownStates().has('valid')).toBe(true);
  });

  test('ignores non-object stored data', async () => {
    mockStorageSessionGet.mockResolvedValue({
      lastKnownState: 'not-an-object',
    });

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(0);
  });

  test('ignores array stored data', async () => {
    mockStorageSessionGet.mockResolvedValue({
      lastKnownState: ['not', 'an', 'object'],
    });

    await loadLastKnownStateFromSession();

    expect(getLastKnownStates().size).toBe(0);
  });

  test('clears pre-existing map entries before populating from session', async () => {
    // Pre-populate the map with a stale entry
    await updateLastKnownState('stale-plugin', makeStateInfo('ready'));
    expect(getLastKnownStates().has('stale-plugin')).toBe(true);

    // Session storage has different data
    mockStorageSessionGet.mockResolvedValue({
      lastKnownState: {
        'new-plugin': JSON.stringify({ state: 'closed', tabs: [] }),
      },
    });

    await loadLastKnownStateFromSession();

    // Stale entry must be gone — not merged with session data
    expect(getLastKnownStates().has('stale-plugin')).toBe(false);
    // Only the session entry should be present
    expect(getLastKnownStates().size).toBe(1);
    expect(getAggregateState(getLastKnownStates().get('new-plugin') ?? '')).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// flushLastKnownStateToSession
// ---------------------------------------------------------------------------

describe('flushLastKnownStateToSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearTabStateCache();
    mockStorageSessionSet.mockClear();
    mockStorageSessionRemove.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('writes to session storage immediately without waiting for debounce', async () => {
    const plugin = makePlugin({ name: 'alpha' });
    await updateLastKnownState(plugin.name, makeStateInfo('ready'));

    // updateLastKnownState schedules a debounce write — not fired yet
    expect(mockStorageSessionSet).not.toHaveBeenCalled();

    flushLastKnownStateToSession();

    // Written immediately — no need to advance timers
    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);
    const written = mockStorageSessionSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toHaveProperty('lastKnownState');
    expect(written.lastKnownState).toHaveProperty('alpha');
  });

  test('cancels pending debounce timer so it does not fire a second write', async () => {
    const plugin = makePlugin({ name: 'beta' });
    await updateLastKnownState(plugin.name, makeStateInfo('closed'));

    flushLastKnownStateToSession();

    // One write from the flush
    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);

    // Advance past the debounce window — no second write should fire
    vi.advanceTimersByTime(500);
    expect(mockStorageSessionSet).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// getAggregateState
// ---------------------------------------------------------------------------

describe('getAggregateState', () => {
  test('returns closed for valid closed state', () => {
    const serialized = JSON.stringify({ state: 'closed', tabs: [] });
    expect(getAggregateState(serialized)).toBe('closed');
  });

  test('returns ready for valid ready state', () => {
    const serialized = JSON.stringify({ state: 'ready', tabs: [] });
    expect(getAggregateState(serialized)).toBe('ready');
  });

  test('returns unavailable for valid unavailable state', () => {
    const serialized = JSON.stringify({ state: 'unavailable', tabs: [] });
    expect(getAggregateState(serialized)).toBe('unavailable');
  });

  test('falls back to closed for corrupted state value', () => {
    const serialized = JSON.stringify({ state: 'hacked', tabs: [] });
    expect(getAggregateState(serialized)).toBe('closed');
  });

  test('falls back to closed when state is a number', () => {
    const serialized = JSON.stringify({ state: 42, tabs: [] });
    expect(getAggregateState(serialized)).toBe('closed');
  });

  test('falls back to closed when state field is missing', () => {
    const serialized = JSON.stringify({ tabs: [] });
    expect(getAggregateState(serialized)).toBe('closed');
  });

  test('falls back to closed for invalid JSON', () => {
    expect(getAggregateState('not-json')).toBe('closed');
  });
});
