import { vi, describe, expect, test, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing iife-injection.ts so that the
// exported functions bind to the mocked versions of dependencies.
// ---------------------------------------------------------------------------

vi.mock('./constants.js', () => ({
  INJECTION_RETRY_DELAY_MS: 0,
  isValidPluginName: (name: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name),
}));

vi.mock('./plugin-storage.js', () => ({
  storePluginsBatch: vi.fn(),
  removePlugin: vi.fn(),
  removePluginsBatch: vi.fn(),
  getAllPluginMeta: vi.fn(),
  getPluginMeta: vi.fn(),
  invalidatePluginCache: vi.fn(),
}));

vi.mock('./tab-matching.js', () => ({
  urlMatchesPatterns: vi.fn(),
  matchPattern: vi.fn(),
  findAllMatchingTabs: vi.fn(),
  findMatchingTab: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Chrome API stubs
// ---------------------------------------------------------------------------

const mockTabsQuery = vi.fn<(queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
const mockExecuteScript = vi.fn<(injection: unknown) => Promise<Array<{ result?: unknown }>>>();

(globalThis as Record<string, unknown>).chrome = {
  tabs: { query: mockTabsQuery },
  scripting: { executeScript: mockExecuteScript },
  runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
};

// Import after mocking
const { isSafePluginName, queryMatchingTabIds, verifyAdapterVersion, injectPluginIntoMatchingTabs } =
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
// injectLogRelay nonce management
// ---------------------------------------------------------------------------

describe('injectLogRelay nonce management', () => {
  let fakeWindow: Record<string, unknown>;

  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockExecuteScript.mockReset();
    // Provide a fake window for the ISOLATED world func to run against.
    // The ISOLATED world content script accesses `window` — in Node test
    // context we set it on globalThis so the reference resolves.
    fakeWindow = {};
    (globalThis as Record<string, unknown>).window = fakeWindow;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  test('replaces stale nonces with the new nonce on re-injection', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 42 } as chrome.tabs.Tab]);

    // Execute ISOLATED world funcs in the fake window context;
    // return generic results for all MAIN world calls.
    let isolatedCallCount = 0;
    mockExecuteScript.mockImplementation((raw: unknown) => {
      const injection = raw as Record<string, unknown>;
      if (injection['world'] === 'ISOLATED') {
        isolatedCallCount++;
        const func = injection['func'] as (...args: unknown[]) => void;
        const args = (injection['args'] as unknown[] | undefined) ?? [];
        func(...args);
      }
      return Promise.resolve([{ result: undefined }]);
    });

    // First injection: creates the guard + nonces Set with nonce1
    await injectPluginIntoMatchingTabs('slack', ['*://slack.com/*'], true);
    const nonces = fakeWindow['__opentabs_log_nonces'] as Set<string>;
    expect(nonces).toBeDefined();
    expect(nonces.size).toBe(1);
    const nonce1 = [...nonces][0];

    // Second injection: should clear nonce1 and store only nonce2
    await injectPluginIntoMatchingTabs('slack', ['*://slack.com/*'], true);
    expect(nonces.size).toBe(1);
    const nonce2 = [...nonces][0];
    expect(nonce2).not.toBe(nonce1);

    expect(isolatedCallCount).toBe(2);
  });

  test('nonces Set always has exactly one entry regardless of injection count', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 42 } as chrome.tabs.Tab]);

    mockExecuteScript.mockImplementation((raw: unknown) => {
      const injection = raw as Record<string, unknown>;
      if (injection['world'] === 'ISOLATED') {
        const func = injection['func'] as (...args: unknown[]) => void;
        const args = (injection['args'] as unknown[] | undefined) ?? [];
        func(...args);
      }
      return Promise.resolve([{ result: undefined }]);
    });

    for (let i = 0; i < 10; i++) {
      await injectPluginIntoMatchingTabs('slack', ['*://slack.com/*'], true);
    }

    const nonces = fakeWindow['__opentabs_log_nonces'] as Set<string>;
    expect(nonces.size).toBe(1);
  });
});
