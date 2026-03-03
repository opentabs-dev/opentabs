import { vi, describe, expect, test, beforeEach } from 'vitest';
import type { DisconnectReason } from './extension-messages.js';
import type { ConfigStateBrowserTool, ConfigStateFailedPlugin, ConfigStatePlugin } from '@opentabs-dev/shared';

/** Response shape returned by handleBgGetFullState */
interface FullStateResponse {
  connected: boolean;
  disconnectReason?: DisconnectReason;
  plugins: ConfigStatePlugin[];
  failedPlugins: ConfigStateFailedPlugin[];
  browserTools: ConfigStateBrowserTool[];
  serverVersion?: string;
}

// ---------------------------------------------------------------------------
// Module mocks — set up before importing background-message-handlers.js so
// the module's internal references bind to the mocked versions.
// ---------------------------------------------------------------------------

const {
  mockSendToServer,
  mockForwardToSidePanel,
  mockClearTabStateCache,
  mockStopReadinessPoll,
  mockGetLastKnownStates,
  mockLoadLastKnownStateFromSession,
  mockClearAllConfirmationBadges,
  mockClearConfirmationBackgroundTimeout,
  mockClearConfirmationBadge,
  mockHandleServerMessage,
  mockNotifyDispatchProgress,
  mockGetAllPluginMeta,
  mockGetCachesInitialized,
  mockGetServerStateCache,
  mockClearServerStateCache,
  mockLoadServerStateCacheFromSession,
  mockUpdateServerStateCache,
  mockSendServerRequest,
  mockRejectAllPendingServerRequests,
} = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
  mockForwardToSidePanel: vi.fn(),
  mockClearTabStateCache: vi.fn(),
  mockStopReadinessPoll: vi.fn(),
  mockGetLastKnownStates: vi.fn(() => new Map<string, string>()),
  mockLoadLastKnownStateFromSession: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockClearAllConfirmationBadges: vi.fn(),
  mockClearConfirmationBackgroundTimeout: vi.fn(),
  mockClearConfirmationBadge: vi.fn(),
  mockHandleServerMessage: vi.fn(),
  mockNotifyDispatchProgress: vi.fn(),
  mockGetAllPluginMeta: vi.fn<() => Promise<Record<string, unknown>>>(() => Promise.resolve({})),
  mockGetCachesInitialized: vi.fn<() => boolean>(() => false),
  mockGetServerStateCache: vi.fn<
    () => {
      plugins: unknown[];
      failedPlugins: unknown[];
      browserTools: unknown[];
      serverVersion: string | undefined;
    }
  >(() => ({
    plugins: [],
    failedPlugins: [],
    browserTools: [],
    serverVersion: undefined,
  })),
  mockClearServerStateCache: vi.fn(),
  mockLoadServerStateCacheFromSession: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockUpdateServerStateCache: vi.fn(),
  mockSendServerRequest: vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(() =>
    Promise.resolve({}),
  ),
  mockRejectAllPendingServerRequests: vi.fn(),
}));

vi.mock('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: mockForwardToSidePanel,
}));

vi.mock('./tab-state.js', () => ({
  clearTabStateCache: mockClearTabStateCache,
  stopReadinessPoll: mockStopReadinessPoll,
  getLastKnownStates: mockGetLastKnownStates,
  loadLastKnownStateFromSession: mockLoadLastKnownStateFromSession,
}));

vi.mock('./confirmation-badge.js', () => ({
  clearAllConfirmationBadges: mockClearAllConfirmationBadges,
  clearConfirmationBackgroundTimeout: mockClearConfirmationBackgroundTimeout,
  clearConfirmationBadge: mockClearConfirmationBadge,
}));

vi.mock('./message-router.js', () => ({
  handleServerMessage: mockHandleServerMessage,
}));

vi.mock('./tool-dispatch.js', () => ({
  notifyDispatchProgress: mockNotifyDispatchProgress,
}));

vi.mock('./plugin-storage.js', () => ({
  getAllPluginMeta: mockGetAllPluginMeta,
}));

vi.mock('./server-state-cache.js', () => ({
  getCachesInitialized: mockGetCachesInitialized,
  getServerStateCache: mockGetServerStateCache,
  clearServerStateCache: mockClearServerStateCache,
  loadServerStateCacheFromSession: mockLoadServerStateCacheFromSession,
  updateServerStateCache: mockUpdateServerStateCache,
}));

vi.mock('./server-request.js', () => ({
  sendServerRequest: mockSendServerRequest,
  rejectAllPendingServerRequests: mockRejectAllPendingServerRequests,
}));

// ---------------------------------------------------------------------------
// Chrome API stubs
// ---------------------------------------------------------------------------

const mockStorageSessionGet = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({});
const mockStorageSessionSet = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockStorageLocalGet = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({});
const mockRuntimeSendMessage = vi.fn(() => Promise.resolve());

(globalThis as Record<string, unknown>).chrome = {
  storage: {
    session: {
      get: mockStorageSessionGet,
      set: mockStorageSessionSet,
    },
    local: {
      get: mockStorageLocalGet,
    },
  },
  runtime: {
    sendMessage: mockRuntimeSendMessage,
    id: 'test-extension-id',
  },
};

const {
  handleWsState,
  handleWsMessage,
  handlePluginLogs,
  handleToolProgress,
  handleSpConfirmationResponse,
  handleSpConfirmationTimeout,
  handleBgGetFullState,
  handleBgSetToolEnabled,
  handleBgSetAllToolsEnabled,
  handleBgSetBrowserToolEnabled,
  handleBgSetAllBrowserToolsEnabled,
  handleBgSearchPlugins,
  handleBgInstallPlugin,
  handleBgRemovePlugin,
  handleBgUpdatePlugin,
} = await import('./background-message-handlers.js');

// ---------------------------------------------------------------------------
// Test setup — reset module-level wsConnected state to false before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Drive wsConnected to false by simulating a disconnect, then clear all mocks.
  // handleWsState({connected: false}) always sets wsConnected=false via persistWsConnected,
  // regardless of prior state. Side-effect calls (clearTabStateCache, etc.) are wiped
  // by vi.clearAllMocks() immediately after.
  handleWsState({ connected: false }, () => {});
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleWsState
// ---------------------------------------------------------------------------

describe('handleWsState', () => {
  test('connect: persists wsConnected=true to chrome.storage.session', () => {
    handleWsState({ connected: true }, () => {});

    expect(mockStorageSessionSet).toHaveBeenCalledWith({ wsConnected: true });
  });

  test('connect: forwards connection state to side panel', () => {
    handleWsState({ connected: true }, () => {});

    expect(mockForwardToSidePanel).toHaveBeenCalledWith({
      type: 'sp:connectionState',
      data: { connected: true, disconnectReason: undefined },
    });
  });

  test('connect: does NOT call clearTabStateCache, stopReadinessPoll, or clearAllConfirmationBadges', () => {
    handleWsState({ connected: true }, () => {});

    expect(mockClearTabStateCache).not.toHaveBeenCalled();
    expect(mockStopReadinessPoll).not.toHaveBeenCalled();
    expect(mockClearAllConfirmationBadges).not.toHaveBeenCalled();
  });

  test('disconnect after connect: persists wsConnected=false to chrome.storage.session', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false }, () => {});

    expect(mockStorageSessionSet).toHaveBeenCalledWith({ wsConnected: false });
  });

  test('disconnect after connect: calls stopReadinessPoll', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false }, () => {});

    expect(mockStopReadinessPoll).toHaveBeenCalledOnce();
  });

  test('disconnect after connect: calls clearTabStateCache', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false }, () => {});

    expect(mockClearTabStateCache).toHaveBeenCalledOnce();
  });

  test('disconnect after connect: calls clearAllConfirmationBadges', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false }, () => {});

    expect(mockClearAllConfirmationBadges).toHaveBeenCalledOnce();
  });

  test('disconnect when already disconnected: still calls clearTabStateCache', () => {
    // wsConnected is already false from beforeEach (simulates race where ws:state
    // arrives before restoreWsConnectedState completes — cleanup must always run)
    handleWsState({ connected: false }, () => {});

    expect(mockClearTabStateCache).toHaveBeenCalledOnce();
  });

  test('disconnect when already disconnected: still calls clearAllConfirmationBadges', () => {
    // wsConnected is already false from beforeEach
    handleWsState({ connected: false }, () => {});

    expect(mockClearAllConfirmationBadges).toHaveBeenCalledOnce();
  });

  test('service worker wake race: cleanup runs even when ws:state arrives before restoreWsConnectedState', () => {
    // Simulate the race condition: service worker wakes with wsConnected=false (default),
    // restoreWsConnectedState has not yet completed (storage read still pending),
    // and the offscreen document sends ws:state connected=false.
    // Old code skipped cleanup because wasConnected was false; new code always cleans up.
    handleWsState({ connected: false, disconnectReason: 'server_shutdown' }, () => {});

    expect(mockClearTabStateCache).toHaveBeenCalledOnce();
    expect(mockClearAllConfirmationBadges).toHaveBeenCalledOnce();
  });

  test('disconnect with disconnectReason: forwards reason to side panel', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false, disconnectReason: 'auth_failure' }, () => {});

    expect(mockForwardToSidePanel).toHaveBeenCalledWith({
      type: 'sp:connectionState',
      data: { connected: false, disconnectReason: 'auth_failure' },
    });
  });

  test('sendResponse is called with { ok: true }', () => {
    const sendResponse = vi.fn();
    handleWsState({ connected: true }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// handlePluginLogs
// ---------------------------------------------------------------------------

describe('handlePluginLogs', () => {
  test('does not forward logs when wsConnected is false', () => {
    handlePluginLogs(
      {
        plugin: 'my-plugin',
        entries: [{ level: 'info', message: 'hello', data: undefined, ts: 0 }],
      },
      () => {},
    );

    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('does not forward logs when entries is not an array', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handlePluginLogs({ plugin: 'my-plugin', entries: 'not-an-array' }, () => {});

    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('forwards valid log entries to server when connected', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handlePluginLogs(
      {
        plugin: 'my-plugin',
        entries: [{ level: 'info', message: 'hello', data: { x: 1 }, ts: 1234 }],
      },
      () => {},
    );

    expect(mockSendToServer).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'plugin.log',
      params: {
        plugin: 'my-plugin',
        level: 'info',
        message: 'hello',
        data: { x: 1 },
        ts: 1234,
      },
    });
  });

  test('forwards multiple valid log entries', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handlePluginLogs(
      {
        plugin: 'p',
        entries: [
          { level: 'info', message: 'a', data: null, ts: 1 },
          { level: 'error', message: 'b', data: null, ts: 2 },
        ],
      },
      () => {},
    );

    expect(mockSendToServer).toHaveBeenCalledTimes(2);
  });

  test('skips non-object entries in the array', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handlePluginLogs(
      {
        plugin: 'p',
        entries: ['not-an-object', null, { level: 'info', message: 'valid', data: null, ts: 0 }],
      },
      () => {},
    );

    // Only the valid object entry should be forwarded
    expect(mockSendToServer).toHaveBeenCalledTimes(1);
  });

  test('sendResponse is always called with { ok: true }', () => {
    const sendResponse = vi.fn();
    handlePluginLogs({ entries: [] }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// handleToolProgress
// ---------------------------------------------------------------------------

describe('handleToolProgress', () => {
  test('calls notifyDispatchProgress with correct dispatchId when connected', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleToolProgress({ dispatchId: 'dispatch-abc', progress: 1, total: 10 }, () => {});

    expect(mockNotifyDispatchProgress).toHaveBeenCalledWith('dispatch-abc');
  });

  test('calls notifyDispatchProgress even when wsConnected is false', () => {
    // wsConnected is false from beforeEach
    handleToolProgress({ dispatchId: 'dispatch-xyz', progress: 0, total: 5 }, () => {});

    expect(mockNotifyDispatchProgress).toHaveBeenCalledWith('dispatch-xyz');
  });

  test('does NOT call notifyDispatchProgress when dispatchId is not a string', () => {
    handleToolProgress({ dispatchId: 42, progress: 0, total: 5 }, () => {});

    expect(mockNotifyDispatchProgress).not.toHaveBeenCalled();
  });

  test('sends tool.progress to server when connected and all params are valid', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleToolProgress({ dispatchId: 'abc', progress: 3, total: 10 }, () => {});

    expect(mockSendToServer).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'tool.progress',
      params: { dispatchId: 'abc', progress: 3, total: 10, message: undefined },
    });
  });

  test('includes optional message in tool.progress params', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleToolProgress({ dispatchId: 'abc', progress: 5, total: 10, message: 'Processing...' }, () => {});

    expect(mockSendToServer).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'tool.progress',
      params: { dispatchId: 'abc', progress: 5, total: 10, message: 'Processing...' },
    });
  });

  test('does NOT send to server when wsConnected is false', () => {
    handleToolProgress({ dispatchId: 'abc', progress: 3, total: 10 }, () => {});

    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('does NOT send to server when progress is not a number', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleToolProgress({ dispatchId: 'abc', progress: 'bad', total: 10 }, () => {});

    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('sendResponse is always called with { ok: true }', () => {
    const sendResponse = vi.fn();
    handleToolProgress({}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// handleSpConfirmationResponse
// ---------------------------------------------------------------------------

describe('handleSpConfirmationResponse', () => {
  test('sends confirmation.response to server when connected', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    const data = { id: 'conf-1', approved: true };
    handleSpConfirmationResponse({ data }, () => {});

    expect(mockSendToServer).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'confirmation.response',
      params: data,
    });
  });

  test('does NOT send to server when wsConnected is false', () => {
    handleSpConfirmationResponse({ data: { id: 'conf-1', approved: true } }, () => {});

    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  test('clears background timeout when data.id is a string', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleSpConfirmationResponse({ data: { id: 'conf-42' } }, () => {});

    expect(mockClearConfirmationBackgroundTimeout).toHaveBeenCalledWith('conf-42');
  });

  test('does NOT call clearConfirmationBackgroundTimeout when data.id is not a string', () => {
    handleSpConfirmationResponse({ data: { id: 99 } }, () => {});

    expect(mockClearConfirmationBackgroundTimeout).not.toHaveBeenCalled();
  });

  test('always calls clearConfirmationBadge', () => {
    handleSpConfirmationResponse({ data: {} }, () => {});

    expect(mockClearConfirmationBadge).toHaveBeenCalledOnce();
  });

  test('sendResponse is always called with { ok: true }', () => {
    const sendResponse = vi.fn();
    handleSpConfirmationResponse({ data: {} }, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// handleSpConfirmationTimeout
// ---------------------------------------------------------------------------

describe('handleSpConfirmationTimeout', () => {
  test('clears background timeout when message.id is a string', () => {
    handleSpConfirmationTimeout({ id: 'conf-1' }, () => {});

    expect(mockClearConfirmationBackgroundTimeout).toHaveBeenCalledWith('conf-1');
  });

  test('does NOT call clearConfirmationBackgroundTimeout when id is not a string', () => {
    handleSpConfirmationTimeout({ id: 123 }, () => {});

    expect(mockClearConfirmationBackgroundTimeout).not.toHaveBeenCalled();
  });

  test('always calls clearConfirmationBadge', () => {
    handleSpConfirmationTimeout({}, () => {});

    expect(mockClearConfirmationBadge).toHaveBeenCalledOnce();
  });

  test('sendResponse is called with { ok: true }', () => {
    const sendResponse = vi.fn();
    handleSpConfirmationTimeout({}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// handleBgGetFullState
// ---------------------------------------------------------------------------

describe('handleBgGetFullState', () => {
  test('returns empty state when no plugins exist', async () => {
    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse).toHaveBeenCalledWith({
      connected: false,
      disconnectReason: undefined,
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
  });

  test('merges plugin metadata with server cache and tab state', async () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'test-plugin': {
        name: 'test-plugin',
        displayName: 'Test Plugin',
        version: '1.0.0',
        trustTier: 'community',
        urlPatterns: ['https://example.com/*'],
        tools: [{ name: 'test_tool', displayName: 'Test Tool', description: 'A test tool' }],
        iconSvg: '<svg/>',
      },
    });

    mockGetServerStateCache.mockReturnValueOnce({
      plugins: [
        {
          name: 'test-plugin',
          displayName: 'Test Plugin',
          version: '1.0.0',
          trustTier: 'community',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: ['https://example.com/*'],
          sdkVersion: '2.0.0',
          tools: [{ name: 'test_tool', displayName: 'Test Tool', description: 'A test tool', enabled: false }],
        },
      ],
      failedPlugins: [{ specifier: 'bad-plugin', error: 'load failed' }],
      browserTools: [{ name: 'screenshot', description: 'Take a screenshot', enabled: true }],
      serverVersion: '1.2.3',
    });

    mockGetLastKnownStates.mockReturnValueOnce(
      new Map([
        [
          'test-plugin',
          JSON.stringify({
            state: 'ready',
            tabs: [{ tabId: 1, url: 'https://example.com', title: 'Example', ready: true }],
          }),
        ],
      ]),
    );

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        connected: true,
        serverVersion: '1.2.3',
        failedPlugins: [{ specifier: 'bad-plugin', error: 'load failed' }],
        browserTools: [{ name: 'screenshot', description: 'Take a screenshot', enabled: true }],
      }),
    );

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      name: 'test-plugin',
      tabState: 'ready',
      source: 'npm',
      sdkVersion: '2.0.0',
    });
    expect(result.plugins[0]?.tools).toHaveLength(1);
    expect(result.plugins[0]?.tools[0]).toMatchObject({ enabled: false });
  });

  test('defaults tool enabled to true when server cache is empty', async () => {
    mockGetAllPluginMeta.mockResolvedValueOnce({
      'test-plugin': {
        name: 'test-plugin',
        displayName: 'Test Plugin',
        version: '1.0.0',
        trustTier: 'local',
        urlPatterns: [],
        tools: [{ name: 'my_tool', displayName: 'My Tool', description: 'desc' }],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      source: 'local',
      tabState: 'closed',
    });
    expect(result.plugins[0]?.tools).toHaveLength(1);
    expect(result.plugins[0]?.tools[0]).toMatchObject({ enabled: true });
  });

  test('loads from session storage on service worker wake (connected but empty caches)', async () => {
    // Simulate service worker wake: wsConnected=true but in-memory caches are empty.
    // cachesInitialized=true indicates sync.full ran before suspension, so the
    // empty caches mean data was lost during suspension, not that sync.full hasn't arrived.
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    // Both caches return empty (simulating post-wake state)
    mockGetLastKnownStates.mockReturnValue(new Map());
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
    mockGetCachesInitialized.mockReturnValue(true);

    // After session load, caches will be populated
    mockLoadLastKnownStateFromSession.mockImplementationOnce(() => {
      // Simulate session storage populating the lastKnownState cache
      mockGetLastKnownStates.mockReturnValue(
        new Map([
          [
            'restored-plugin',
            JSON.stringify({
              state: 'ready',
              tabs: [{ tabId: 5, url: 'https://restored.com', title: 'Restored', ready: true }],
            }),
          ],
        ]),
      );
      return Promise.resolve();
    });

    mockLoadServerStateCacheFromSession.mockImplementationOnce(() => {
      // Simulate session storage populating the server state cache
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          {
            name: 'restored-plugin',
            displayName: 'Restored Plugin',
            version: '1.0.0',
            trustTier: 'community',
            source: 'npm',
            tabState: 'closed',
            urlPatterns: [],
            sdkVersion: '2.0.0',
            tools: [{ name: 'tool_a', displayName: 'Tool A', description: 'desc', enabled: false }],
          },
        ],
        failedPlugins: [],
        browserTools: [{ name: 'screenshot', description: 'Take a screenshot', enabled: true }],
        serverVersion: '3.0.0',
      });
      return Promise.resolve();
    });

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'restored-plugin': {
        name: 'restored-plugin',
        displayName: 'Restored Plugin',
        version: '1.0.0',
        trustTier: 'community',
        urlPatterns: [],
        tools: [{ name: 'tool_a', displayName: 'Tool A', description: 'desc' }],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Session storage loaders should have been called
    expect(mockLoadLastKnownStateFromSession).toHaveBeenCalledOnce();
    expect(mockLoadServerStateCacheFromSession).toHaveBeenCalledOnce();

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
    expect(result.serverVersion).toBe('3.0.0');
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      name: 'restored-plugin',
      tabState: 'ready',
      source: 'npm',
      sdkVersion: '2.0.0',
    });
    expect(result.plugins[0]?.tools).toHaveLength(1);
    expect(result.plugins[0]?.tools[0]).toMatchObject({ enabled: false });
  });

  test('does NOT load from session storage when already connected with populated caches', async () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    // Caches already populated — no session load needed
    mockGetLastKnownStates.mockReturnValue(
      new Map([['existing-plugin', JSON.stringify({ state: 'ready', tabs: [] })]]),
    );
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'existing-plugin',
          displayName: 'Existing',
          version: '1.0.0',
          trustTier: 'local',
          source: 'local',
          tabState: 'ready',
          urlPatterns: [],
          tools: [],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'existing-plugin': {
        name: 'existing-plugin',
        displayName: 'Existing',
        version: '1.0.0',
        trustTier: 'local',
        urlPatterns: [],
        tools: [],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(mockLoadLastKnownStateFromSession).not.toHaveBeenCalled();
    expect(mockLoadServerStateCacheFromSession).not.toHaveBeenCalled();
  });

  test('does NOT load from session storage when disconnected with empty caches', async () => {
    // wsConnected is false (from beforeEach), caches are empty — this is normal disconnect state, not wake
    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(mockLoadLastKnownStateFromSession).not.toHaveBeenCalled();
    expect(mockLoadServerStateCacheFromSession).not.toHaveBeenCalled();
  });

  test('does NOT load from session storage during connect-to-sync.full gap (cachesInitialized=false)', async () => {
    // Simulate the false positive: WebSocket just connected (wsConnected=true) but
    // sync.full has not arrived yet (cachesInitialized=false, caches empty).
    // Without the cachesInitialized guard, stale session data would be restored.
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetLastKnownStates.mockReturnValue(new Map());
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
    mockGetCachesInitialized.mockReturnValue(false);
    mockGetAllPluginMeta.mockResolvedValueOnce({});

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Session storage loaders must NOT be called — this is the connect-to-sync.full gap
    expect(mockLoadLastKnownStateFromSession).not.toHaveBeenCalled();
    expect(mockLoadServerStateCacheFromSession).not.toHaveBeenCalled();

    // Response should return empty plugins (no stale data restored)
    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('loads from session storage after sync.full + suspension (cachesInitialized=true)', async () => {
    // Simulate real wake: sync.full already ran (cachesInitialized=true), then service
    // worker was suspended. On wake, in-memory caches are empty but session storage
    // has the data. This should trigger session restoration.
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetLastKnownStates.mockReturnValue(new Map());
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
    mockGetCachesInitialized.mockReturnValue(true);

    mockLoadLastKnownStateFromSession.mockImplementationOnce(() => {
      mockGetLastKnownStates.mockReturnValue(new Map([['wake-plugin', JSON.stringify({ state: 'ready', tabs: [] })]]));
      return Promise.resolve();
    });

    mockLoadServerStateCacheFromSession.mockImplementationOnce(() => {
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          {
            name: 'wake-plugin',
            displayName: 'Wake Plugin',
            version: '1.0.0',
            trustTier: 'local',
            source: 'local',
            tabState: 'closed',
            urlPatterns: [],
            tools: [{ name: 'tool_x', displayName: 'Tool X', description: 'desc', enabled: true }],
          },
        ],
        failedPlugins: [],
        browserTools: [],
        serverVersion: '5.0.0',
      });
      return Promise.resolve();
    });

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'wake-plugin': {
        name: 'wake-plugin',
        displayName: 'Wake Plugin',
        version: '1.0.0',
        trustTier: 'local',
        urlPatterns: [],
        tools: [{ name: 'tool_x', displayName: 'Tool X', description: 'desc' }],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Session storage loaders SHOULD be called — this is a real wake
    expect(mockLoadLastKnownStateFromSession).toHaveBeenCalledOnce();
    expect(mockLoadServerStateCacheFromSession).toHaveBeenCalledOnce();

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
    expect(result.serverVersion).toBe('5.0.0');
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({ name: 'wake-plugin', tabState: 'ready' });
  });
});

// ---------------------------------------------------------------------------
// handleWsState — rejectAllPendingServerRequests on disconnect
// ---------------------------------------------------------------------------

describe('handleWsState — rejectAllPendingServerRequests', () => {
  test('calls rejectAllPendingServerRequests on disconnect', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    handleWsState({ connected: false }, () => {});

    expect(mockRejectAllPendingServerRequests).toHaveBeenCalledOnce();
  });

  test('does NOT call rejectAllPendingServerRequests on connect', () => {
    handleWsState({ connected: true }, () => {});

    expect(mockRejectAllPendingServerRequests).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// bg:setToolEnabled
// ---------------------------------------------------------------------------

describe('handleBgSetToolEnabled', () => {
  test('optimistically updates server state cache and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          trustTier: 'community',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [{ name: 'send', displayName: 'Send', description: 'desc', enabled: true }],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetToolEnabled({ plugin: 'slack', tool: 'send', enabled: false }, sendResponse);

    // Optimistic update should have been called
    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      plugins: Array<{ tools: Array<{ enabled: boolean }> }>;
    };
    expect(updateCall.plugins[0]?.tools[0]?.enabled).toBe(false);

    // sendServerRequest should have been called
    expect(mockSendServerRequest).toHaveBeenCalledWith('config.setToolEnabled', {
      plugin: 'slack',
      tool: 'send',
      enabled: false,
    });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test('reverts optimistic update on server error', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          trustTier: 'community',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [{ name: 'send', displayName: 'Send', description: 'desc', enabled: true }],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolEnabled({ plugin: 'slack', tool: 'send', enabled: false }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Should have been called twice: optimistic + revert
    expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(2);
    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{ tools: Array<{ enabled: boolean }> }>;
    };
    expect(revertCall.plugins[0]?.tools[0]?.enabled).toBe(true);

    expect(sendResponse).toHaveBeenCalledWith({ error: 'Server error' });
  });

  test('revert restores exact pre-mutation state, not toggled !enabled', async () => {
    // Tool starts disabled. Calling with enabled: false (same value) must revert to false,
    // not flip to !false = true as a naive !enabled approach would do.
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          trustTier: 'community',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [{ name: 'send', displayName: 'Send', description: 'desc', enabled: false }],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolEnabled({ plugin: 'slack', tool: 'send', enabled: false }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{ tools: Array<{ enabled: boolean }> }>;
    };
    // Must restore original enabled: false, not flip to true
    expect(revertCall.plugins[0]?.tools[0]?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bg:setAllToolsEnabled
// ---------------------------------------------------------------------------

describe('handleBgSetAllToolsEnabled', () => {
  test('optimistically updates all tools and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          trustTier: 'community',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            { name: 'send', displayName: 'Send', description: 'desc', enabled: true },
            { name: 'read', displayName: 'Read', description: 'desc', enabled: true },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllToolsEnabled({ plugin: 'slack', enabled: false }, sendResponse);

    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      plugins: Array<{ tools: Array<{ enabled: boolean }> }>;
    };
    expect(updateCall.plugins[0]?.tools.every(t => !t.enabled)).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// bg:setBrowserToolEnabled
// ---------------------------------------------------------------------------

describe('handleBgSetBrowserToolEnabled', () => {
  test('optimistically updates browser tool and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'screenshot', description: 'Take a screenshot', enabled: true },
        { name: 'console', description: 'Get console logs', enabled: true },
      ],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetBrowserToolEnabled({ tool: 'screenshot', enabled: false }, sendResponse);

    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      browserTools: Array<{ name: string; enabled: boolean }>;
    };
    expect(updateCall.browserTools.find(bt => bt.name === 'screenshot')?.enabled).toBe(false);
    expect(updateCall.browserTools.find(bt => bt.name === 'console')?.enabled).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test('reverts to exact pre-mutation state on server error', async () => {
    // Browser tool starts disabled. Calling with enabled: false (same value) must revert
    // to false, not flip to !false = true as a naive !enabled approach would do.
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'screenshot', description: 'Take a screenshot', enabled: false },
        { name: 'console', description: 'Get console logs', enabled: true },
      ],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetBrowserToolEnabled({ tool: 'screenshot', enabled: false }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Should have been called twice: optimistic + revert
    expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(2);
    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      browserTools: Array<{ name: string; enabled: boolean }>;
    };
    // Must restore original enabled: false, not flip to true
    expect(revertCall.browserTools.find(bt => bt.name === 'screenshot')?.enabled).toBe(false);
    // Other tools are untouched in the captured original
    expect(revertCall.browserTools.find(bt => bt.name === 'console')?.enabled).toBe(true);

    expect(sendResponse).toHaveBeenCalledWith({ error: 'Server error' });
  });
});

// ---------------------------------------------------------------------------
// bg:setAllBrowserToolsEnabled
// ---------------------------------------------------------------------------

describe('handleBgSetAllBrowserToolsEnabled', () => {
  test('optimistically updates all browser tools and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'screenshot', description: 'Take a screenshot', enabled: true },
        { name: 'console', description: 'Get console logs', enabled: true },
      ],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllBrowserToolsEnabled({ enabled: false }, sendResponse);

    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as { browserTools: Array<{ enabled: boolean }> };
    expect(updateCall.browserTools.every(bt => !bt.enabled)).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// bg:searchPlugins
// ---------------------------------------------------------------------------

describe('handleBgSearchPlugins', () => {
  test('relays plugin.search to the server and returns results', async () => {
    const results = { results: [{ name: 'opentabs-plugin-test', description: 'test', version: '1.0.0' }] };
    mockSendServerRequest.mockResolvedValueOnce(results);

    const sendResponse = vi.fn();
    handleBgSearchPlugins({ query: 'test' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.search', { query: 'test' });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith(results);
  });

  test('returns error on server failure', async () => {
    mockSendServerRequest.mockRejectedValueOnce(new Error('Search failed'));

    const sendResponse = vi.fn();
    handleBgSearchPlugins({ query: 'test' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ error: 'Search failed' });
  });
});

// ---------------------------------------------------------------------------
// bg:installPlugin
// ---------------------------------------------------------------------------

describe('handleBgInstallPlugin', () => {
  test('relays plugin.install to the server and returns result', async () => {
    const result = { ok: true, plugin: { name: 'test', displayName: 'Test', version: '1.0.0', toolCount: 2 } };
    mockSendServerRequest.mockResolvedValueOnce(result);

    const sendResponse = vi.fn();
    handleBgInstallPlugin({ name: 'opentabs-plugin-test' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.install', { name: 'opentabs-plugin-test' });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith(result);
  });
});

// ---------------------------------------------------------------------------
// bg:removePlugin
// ---------------------------------------------------------------------------

describe('handleBgRemovePlugin', () => {
  test('relays plugin.remove to the server and returns result', async () => {
    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgRemovePlugin({ name: 'test-plugin' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.remove', { name: 'test-plugin' });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// bg:updatePlugin
// ---------------------------------------------------------------------------

describe('handleBgUpdatePlugin', () => {
  test('relays plugin.updateFromRegistry to the server and returns result', async () => {
    const result = { ok: true, plugin: { name: 'test', displayName: 'Test', version: '2.0.0', toolCount: 3 } };
    mockSendServerRequest.mockResolvedValueOnce(result);

    const sendResponse = vi.fn();
    handleBgUpdatePlugin({ name: 'test-plugin' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.updateFromRegistry', { name: 'test-plugin' });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith(result);
  });
});

// ---------------------------------------------------------------------------
// handleWsMessage
// ---------------------------------------------------------------------------

describe('handleWsMessage', () => {
  test('relays message data to handleServerMessage and calls sendResponse', () => {
    const sendResponse = vi.fn();
    const data = { jsonrpc: '2.0', method: 'plugins.changed', params: {} };

    handleWsMessage({ data }, sendResponse);

    expect(mockHandleServerMessage).toHaveBeenCalledWith(data);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test('calls sendResponse even when handleServerMessage throws', () => {
    mockHandleServerMessage.mockImplementationOnce(() => {
      throw new Error('handleServerMessage failed');
    });

    const sendResponse = vi.fn();
    handleWsMessage({ data: { jsonrpc: '2.0', method: 'bad.method' } }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});
