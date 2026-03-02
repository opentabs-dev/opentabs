import { vi, describe, expect, test, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing handler modules
// ---------------------------------------------------------------------------

const { mockSendToServer } = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
}));

vi.mock('../messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: vi.fn(),
}));

vi.mock('../sanitize-error.js', () => ({
  sanitizeErrorMessage: (msg: string) => msg,
}));

vi.mock('../constants.js', () => ({
  ADAPTER_HASH_PROP: '__adapterHash',
  buildWsUrl: (port: number) => `ws://localhost:${port}/ws`,
  DEFAULT_LOG_LIMIT: 100,
  DEFAULT_SERVER_PORT: 9515,
  EXEC_MAX_ASYNC_WAIT_MS: 10000,
  EXEC_POLL_INTERVAL_MS: 50,
  EXEC_RESULT_TRUNCATION_LIMIT: 50000,
  IS_READY_TIMEOUT_MS: 100,
  SCRIPT_TIMEOUT_MS: 30000,
  SERVER_PORT_KEY: 'serverPort',
  SIDE_PANEL_TIMEOUT_MS: 3000,
  WS_CONNECTED_KEY: 'wsConnected',
  WS_FLUSH_DELAY_MS: 50,
}));

vi.mock('../background-log-state.js', () => ({
  bgLogCollector: {
    getEntries: vi.fn(() => []),
    getStats: vi.fn(() => ({ totalCaptured: 0, bufferSize: 0, oldestTimestamp: null, newestTimestamp: null })),
  },
}));

vi.mock('../network-capture.js', () => ({
  getActiveCapturesSummary: vi.fn(() => []),
}));

vi.mock('../plugin-storage.js', () => ({
  getAllPluginMeta: vi.fn(() => Promise.resolve({})),
  getPluginMeta: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../tab-matching.js', () => ({
  findAllMatchingTabs: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../tab-state.js', () => ({
  getLastKnownStates: vi.fn(() => new Map()),
  getAggregateState: vi.fn(() => 'closed'),
}));

// Stub chrome APIs
const mockExecuteScript = vi.fn<(opts: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
const mockSendMessage = vi.fn<(msg: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    runtime: {
      id: 'test-extension-id',
      sendMessage: mockSendMessage,
      getContexts: vi.fn(() => Promise.resolve([])),
    },
    scripting: { executeScript: mockExecuteScript },
    storage: {
      session: { get: vi.fn(() => Promise.resolve({})) },
      local: { get: vi.fn(() => Promise.resolve({})) },
    },
  },
});

// Import after mocking
const { ADAPTER_HASH_PROP } = await import('../constants.js');
const { getPluginMeta } = await import('../plugin-storage.js');
const { findAllMatchingTabs } = await import('../tab-matching.js');
const { handleExtensionCheckAdapter, handleBrowserExecuteScript, handleExtensionGetSidePanel } =
  await import('./extension-commands.js');

/** Extract the first argument from the first call to mockSendToServer */
const firstSentMessage = (): Record<string, unknown> => {
  const calls = mockSendToServer.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const firstCall = calls[0];
  if (!firstCall) throw new Error('Expected at least one call');
  return firstCall[0] as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// handleExtensionGetSidePanel
// ---------------------------------------------------------------------------

describe('handleExtensionGetSidePanel', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockSendMessage.mockReset();
  });

  test('returns side panel state and clears timeout when sendMessage resolves first', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    mockSendMessage.mockResolvedValueOnce({ state: { theme: 'dark' }, html: '<div/>' });

    await handleExtensionGetSidePanel('req-sp-1');

    vi.useRealTimers();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-sp-1',
      result: { open: true, state: { theme: 'dark' }, html: '<div/>' },
    });

    clearTimeoutSpy.mockRestore();
  });

  test('returns open: false when timeout fires before sendMessage', async () => {
    vi.useFakeTimers();

    // sendMessage never resolves — timeout wins
    mockSendMessage.mockReturnValueOnce(new Promise(() => {}));

    const promise = handleExtensionGetSidePanel('req-sp-2');
    await vi.advanceTimersByTimeAsync(3001); // past SIDE_PANEL_TIMEOUT_MS (3000ms)
    await promise;

    vi.useRealTimers();

    expect(firstSentMessage()).toMatchObject({ result: { open: false } });
  });
});

// ---------------------------------------------------------------------------
// handleExtensionCheckAdapter
// ---------------------------------------------------------------------------

describe('handleExtensionCheckAdapter', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
  });

  test('rejects missing plugin param', async () => {
    await handleExtensionCheckAdapter({}, 'req-1');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602, message: 'Missing or invalid plugin parameter' },
    });
  });

  test('rejects empty plugin param', async () => {
    await handleExtensionCheckAdapter({ plugin: '' }, 'req-2');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid plugin parameter' },
    });
  });

  test('rejects non-string plugin param', async () => {
    await handleExtensionCheckAdapter({ plugin: 42 }, 'req-3');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid plugin parameter' },
    });
  });

  test('rejects unknown plugin with -32602', async () => {
    await handleExtensionCheckAdapter({ plugin: 'nonexistent' }, 'req-4');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-4',
      error: { code: -32602, message: 'Plugin not found: "nonexistent"' },
    });
  });

  test('adapter inspection func reads __adapterHash (not __hash)', async () => {
    vi.mocked(getPluginMeta).mockResolvedValueOnce({
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      urlPatterns: ['https://example.com/*'],
      trustTier: 'local',
      tools: [],
    } as Awaited<ReturnType<typeof getPluginMeta>>);
    vi.mocked(findAllMatchingTabs).mockResolvedValueOnce([{ id: 200, url: 'https://example.com' } as chrome.tabs.Tab]);

    mockExecuteScript
      .mockResolvedValueOnce([{ result: { adapterPresent: true, adapterHash: 'abc', toolCount: 0, toolNames: [] } }])
      .mockResolvedValueOnce([{ result: true }]);

    await handleExtensionCheckAdapter({ plugin: 'test-plugin' }, 'req-hash-prop');

    // The first executeScript call is the adapter inspection — verify its func references __adapterHash
    const firstCall = mockExecuteScript.mock.calls[0] as unknown[];
    const opts = firstCall[0] as { func: (...args: unknown[]) => unknown };
    const funcSource = opts.func.toString();
    expect(funcSource).toContain(ADAPTER_HASH_PROP);
    // Verify the old typo (__hash without the adapter prefix) is not present.
    // Replace all occurrences of ADAPTER_HASH_PROP first to avoid false positives.
    const withoutAdapterHash = funcSource.replaceAll(ADAPTER_HASH_PROP, '');
    expect(withoutAdapterHash).not.toContain('__hash');
  });

  test('clears isReady timeout when executeScript resolves before IS_READY_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    vi.mocked(getPluginMeta).mockResolvedValueOnce({
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test Plugin',
      urlPatterns: ['https://example.com/*'],
      trustTier: 'local',
      tools: [],
    } as Awaited<ReturnType<typeof getPluginMeta>>);
    vi.mocked(findAllMatchingTabs).mockResolvedValueOnce([{ id: 100, url: 'https://example.com' } as chrome.tabs.Tab]);

    // First executeScript: adapter inspection — returns adapterPresent: true
    // Second executeScript: isReady probe — returns true
    mockExecuteScript
      .mockResolvedValueOnce([
        { result: { adapterPresent: true, adapterHash: 'abc', toolCount: 1, toolNames: ['do_thing'] } },
      ])
      .mockResolvedValueOnce([{ result: true }]);

    await handleExtensionCheckAdapter({ plugin: 'test-plugin' }, 'req-ca-ready');

    vi.useRealTimers();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(firstSentMessage()).toMatchObject({
      result: { plugin: 'test-plugin', matchingTabs: [expect.objectContaining({ tabId: 100, isReady: true })] },
    });

    clearTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleBrowserExecuteScript
// ---------------------------------------------------------------------------

describe('handleBrowserExecuteScript', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserExecuteScript({ execFile: '__exec-abc123.js' }, 'req-10');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects missing execFile', async () => {
    await handleBrowserExecuteScript({ tabId: 1 }, 'req-11');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid execFile parameter' },
    });
  });

  test('rejects empty execFile', async () => {
    await handleBrowserExecuteScript({ tabId: 1, execFile: '' }, 'req-12');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid execFile parameter' },
    });
  });

  test('rejects non-string execFile', async () => {
    await handleBrowserExecuteScript({ tabId: 1, execFile: 123 }, 'req-13');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects invalid execFile format', async () => {
    await handleBrowserExecuteScript({ tabId: 1, execFile: 'malicious.js' }, 'req-14');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-14',
      error: { code: -32602, message: 'Invalid execFile format' },
    });
  });

  test('rejects execFile without __exec- prefix', async () => {
    await handleBrowserExecuteScript({ tabId: 1, execFile: 'script-abc123.js' }, 'req-15');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Invalid execFile format' },
    });
  });

  test('rejects execFile with path traversal', async () => {
    await handleBrowserExecuteScript({ tabId: 1, execFile: '../__exec-abc123.js' }, 'req-16');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Invalid execFile format' },
    });
  });

  describe('execution and cancellation', () => {
    beforeEach(() => {
      mockSendToServer.mockReset();
      mockExecuteScript.mockReset();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('returns sync result on first poll', async () => {
      let callCount = 0;
      mockExecuteScript.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]); // file injection
        return Promise.resolve([{ result: { pending: false, result: { value: 42 } } }]);
      });

      const handlerPromise = handleBrowserExecuteScript({ tabId: 1, execFile: '__exec-abc123.js' }, 'req-sync');
      await vi.runAllTimersAsync();
      await handlerPromise;

      expect(firstSentMessage()).toMatchObject({ result: { value: { value: 42 } } });
      // 3 calls: file injection + 1 poll (with inline cleanup) + finally cleanup
      expect(mockExecuteScript).toHaveBeenCalledTimes(3);
    });

    test('sends timeout error and skips cleanup when outer SCRIPT_TIMEOUT_MS fires during initial injection', async () => {
      // File injection hangs indefinitely (simulates a tab that stops responding)
      mockExecuteScript.mockImplementation(() => new Promise(() => {}));

      const handlerPromise = handleBrowserExecuteScript(
        { tabId: 1, execFile: '__exec-abc123.js' },
        'req-outer-timeout',
      );

      await vi.advanceTimersByTimeAsync(30001);
      await handlerPromise;

      expect(firstSentMessage()).toMatchObject({
        error: { message: 'Script execution timed out after 30000ms' },
      });
      // Only the initial injection was attempted — no poll calls, no cleanup call
      expect(mockExecuteScript).toHaveBeenCalledTimes(1);
    });

    test('runs cleanup when outer SCRIPT_TIMEOUT_MS fires during injection and injection later completes', async () => {
      // Simulates slow injection: the outer timeout fires while the file injection is still
      // pending. When injection eventually resolves, the globals are set in the tab.
      // injectPromise resumes, enters the polling loop, immediately sees cancelled.value = true,
      // returns via the if-guard, and the try/finally ensures cleanup runs.
      let resolveInjection!: (value: unknown[]) => void;
      let callCount = 0;

      mockExecuteScript.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Injection hangs until manually resolved after the outer timeout fires
          return new Promise<unknown[]>(resolve => {
            resolveInjection = resolve;
          });
        }
        // Any subsequent call (polling or cleanup) — return immediately
        return Promise.resolve([{ result: { pending: false, result: { value: 1 } } }]);
      });

      const handlerPromise = handleBrowserExecuteScript(
        { tabId: 1, execFile: '__exec-abc123.js' },
        'req-cleanup-late-injection',
      );

      // Advance past SCRIPT_TIMEOUT_MS (30000ms) while injection is still pending
      await vi.advanceTimersByTimeAsync(30001);
      await handlerPromise; // handler settles: cancelled.value = true, error response sent

      // Resolve injection late — in production, this means globals are now set in the tab
      resolveInjection([]);
      // Flush microtasks: injectPromise resumes → enters while loop → if (cancelled.value) return
      // → finally block fires cleanup
      await Promise.resolve();
      await Promise.resolve();

      expect(firstSentMessage()).toMatchObject({
        error: { message: 'Script execution timed out after 30000ms' },
      });

      // Cleanup must have been called (try/finally ensures this even after cancellation)
      const calls = mockExecuteScript.mock.calls;
      const cleanupCall = calls.find(call => {
        const opts = (call as unknown[])[0] as Record<string, unknown>;
        return Array.isArray(opts.args) && (opts.args as string[]).includes('__execResult_abc123');
      });
      expect(cleanupCall).toBeDefined();
      const opts = (cleanupCall as unknown[])[0] as Record<string, unknown>;
      expect(opts.args).toEqual(['__execResult_abc123', '__execAsync_abc123']);
    });

    test('runs cleanup script when inner EXEC_MAX_ASYNC_WAIT_MS fires before outer timeout', async () => {
      let callCount = 0;
      mockExecuteScript.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]); // file injection
        return Promise.resolve([{ result: { pending: true } }]); // always pending
      });

      const handlerPromise = handleBrowserExecuteScript(
        { tabId: 1, execFile: '__exec-abc123.js' },
        'req-inner-timeout',
      );

      // Advance past EXEC_MAX_ASYNC_WAIT_MS (10000ms) but not SCRIPT_TIMEOUT_MS (30000ms)
      await vi.advanceTimersByTimeAsync(12000);
      await handlerPromise;

      expect(firstSentMessage()).toMatchObject({
        result: { value: { error: expect.stringContaining('10000') as string } },
      });

      // The last executeScript call must be the cleanup script with namespaced key args
      const calls = mockExecuteScript.mock.calls;
      expect(calls.length).toBeGreaterThan(2);
      const lastCall = (calls[calls.length - 1] as unknown[])[0] as Record<string, unknown>;
      expect(lastCall.world).toBe('MAIN');
      expect(typeof lastCall.func).toBe('function');
      expect(lastCall.args).toEqual(['__execResult_abc123', '__execAsync_abc123']);
    });
  });
});
