import { mock, describe, expect, test, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing iife-injection.ts so that the
// exported functions bind to the mocked versions of dependencies.
// ---------------------------------------------------------------------------

await mock.module('./constants.js', () => ({
  INJECTION_RETRY_DELAY_MS: 0,
  isValidPluginName: (name: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name),
}));

await mock.module('./plugin-storage.js', () => ({
  storePluginsBatch: mock(),
  removePlugin: mock(),
  removePluginsBatch: mock(),
  getAllPluginMeta: mock(),
  getPluginMeta: mock(),
  invalidatePluginCache: mock(),
}));

await mock.module('./tab-matching.js', () => ({
  urlMatchesPatterns: mock(),
  matchPattern: mock(),
  findAllMatchingTabs: mock(),
  findMatchingTab: mock(),
}));

// ---------------------------------------------------------------------------
// Chrome API stubs
// ---------------------------------------------------------------------------

const mockTabsQuery = mock<(queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
const mockExecuteScript = mock<(injection: unknown) => Promise<Array<{ result?: unknown }>>>();

(globalThis as Record<string, unknown>).chrome = {
  tabs: { query: mockTabsQuery },
  scripting: { executeScript: mockExecuteScript },
  runtime: { sendMessage: mock(() => Promise.resolve()) },
};

// Import after mocking
const { isSafePluginName, queryMatchingTabIds, verifyAdapterVersion, teardownAdapterInTab } =
  await import('./iife-injection.js');

// ---------------------------------------------------------------------------
// isSafePluginName
// ---------------------------------------------------------------------------

describe('isSafePluginName', () => {
  test('accepts valid lowercase plugin names', () => {
    expect(isSafePluginName('slack')).toBe(true);
    expect(isSafePluginName('my-plugin')).toBe(true);
    expect(isSafePluginName('plugin123')).toBe(true);
  });

  test('rejects reserved names', () => {
    expect(isSafePluginName('system')).toBe(false);
    expect(isSafePluginName('browser')).toBe(false);
    expect(isSafePluginName('opentabs')).toBe(false);
    expect(isSafePluginName('extension')).toBe(false);
    expect(isSafePluginName('config')).toBe(false);
    expect(isSafePluginName('plugin')).toBe(false);
    expect(isSafePluginName('tool')).toBe(false);
    expect(isSafePluginName('mcp')).toBe(false);
  });

  test('rejects invalid plugin name formats', () => {
    expect(isSafePluginName('')).toBe(false);
    expect(isSafePluginName('UPPERCASE')).toBe(false);
    expect(isSafePluginName('has spaces')).toBe(false);
    expect(isSafePluginName('-leading-dash')).toBe(false);
    expect(isSafePluginName('trailing-dash-')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queryMatchingTabIds
// ---------------------------------------------------------------------------

describe('queryMatchingTabIds', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
  });

  test('returns tab IDs matching a single URL pattern', async () => {
    mockTabsQuery.mockResolvedValue([
      { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab,
      { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab,
    ]);

    const result = await queryMatchingTabIds(['*://example.com/*']);
    expect(result).toEqual([1, 2]);
    expect(mockTabsQuery).toHaveBeenCalledTimes(1);
    expect(mockTabsQuery).toHaveBeenCalledWith({ url: '*://example.com/*' });
  });

  test('deduplicates tab IDs across multiple patterns', async () => {
    mockTabsQuery.mockImplementation((queryInfo: chrome.tabs.QueryInfo) => {
      if (queryInfo.url === '*://example.com/*') {
        return Promise.resolve([
          { id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab,
          { id: 2, url: 'https://example.com/b' } as chrome.tabs.Tab,
        ]);
      }
      if (queryInfo.url === '*://example.com/a') {
        return Promise.resolve([{ id: 1, url: 'https://example.com/a' } as chrome.tabs.Tab]);
      }
      return Promise.resolve([]);
    });

    const result = await queryMatchingTabIds(['*://example.com/*', '*://example.com/a']);
    expect(result).toEqual([1, 2]);
  });

  test('returns empty array for no matching tabs', async () => {
    mockTabsQuery.mockResolvedValue([]);
    const result = await queryMatchingTabIds(['*://nonexistent.com/*']);
    expect(result).toEqual([]);
  });

  test('skips tabs without an id', async () => {
    mockTabsQuery.mockResolvedValue([
      { url: 'https://example.com/a' } as chrome.tabs.Tab,
      { id: 3, url: 'https://example.com/b' } as chrome.tabs.Tab,
    ]);

    const result = await queryMatchingTabIds(['*://example.com/*']);
    expect(result).toEqual([3]);
  });

  test('returns empty array for empty URL patterns', async () => {
    const result = await queryMatchingTabIds([]);
    expect(result).toEqual([]);
    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  test('handles chrome.tabs.query failure gracefully', async () => {
    mockTabsQuery.mockRejectedValue(new Error('Invalid URL pattern'));
    const result = await queryMatchingTabIds(['invalid-pattern']);
    expect(result).toEqual([]);
  });

  test('continues with other patterns when one pattern fails', async () => {
    let callCount = 0;
    mockTabsQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('bad pattern'));
      return Promise.resolve([{ id: 5, url: 'https://good.com/page' } as chrome.tabs.Tab]);
    });

    const result = await queryMatchingTabIds(['bad-pattern', '*://good.com/*']);
    expect(result).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// verifyAdapterVersion
// ---------------------------------------------------------------------------

describe('verifyAdapterVersion', () => {
  beforeEach(() => {
    mockExecuteScript.mockReset();
  });

  test('returns true when adapter version matches', async () => {
    mockExecuteScript.mockResolvedValue([{ result: '2.0.0' }]);

    const result = await verifyAdapterVersion(1, 'slack', '2.0.0');
    expect(result).toBe(true);
  });

  test('returns false when adapter version does not match', async () => {
    mockExecuteScript.mockResolvedValue([{ result: '1.0.0' }]);

    const result = await verifyAdapterVersion(1, 'slack', '2.0.0');
    expect(result).toBe(false);
  });

  test('returns false when adapter has no version', async () => {
    mockExecuteScript.mockResolvedValue([{ result: undefined }]);

    const result = await verifyAdapterVersion(1, 'slack', '2.0.0');
    expect(result).toBe(false);
  });

  test('returns false when executeScript returns empty results', async () => {
    mockExecuteScript.mockResolvedValue([]);

    const result = await verifyAdapterVersion(1, 'slack', '2.0.0');
    expect(result).toBe(false);
  });

  test('returns false when executeScript throws', async () => {
    mockExecuteScript.mockRejectedValue(new Error('No tab with id: 1'));

    const result = await verifyAdapterVersion(1, 'slack', '2.0.0');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// teardownAdapterInTab
// ---------------------------------------------------------------------------

describe('teardownAdapterInTab', () => {
  beforeEach(() => {
    mockExecuteScript.mockReset();
  });

  test('calls executeScript for teardown', async () => {
    mockExecuteScript.mockResolvedValue([{ result: undefined }]);

    await teardownAdapterInTab(42, 'slack');
    expect(mockExecuteScript).toHaveBeenCalledTimes(1);

    const call = mockExecuteScript.mock.calls[0] as [Record<string, unknown>];
    const injection = call[0] as { target: { tabId: number }; world: string; args: string[] };
    expect(injection.target.tabId).toBe(42);
    expect(injection.world).toBe('MAIN');
    expect(injection.args).toEqual(['slack']);
  });

  test('does not throw when executeScript fails', async () => {
    mockExecuteScript.mockRejectedValue(new Error('Tab not found'));

    await teardownAdapterInTab(99, 'slack');
    // If we reach this point, the function did not throw
    expect(true).toBe(true);
  });
});
