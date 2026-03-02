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
  mockGetServerStateCache,
  mockClearServerStateCache,
  mockLoadServerStateCacheFromSession,
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
  getServerStateCache: mockGetServerStateCache,
  clearServerStateCache: mockClearServerStateCache,
  loadServerStateCacheFromSession: mockLoadServerStateCacheFromSession,
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
  handlePluginLogs,
  handleToolProgress,
  handleSpConfirmationResponse,
  handleSpConfirmationTimeout,
  handleBgGetConnectionState,
  handleBgGetFullState,
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
// handleBgGetConnectionState
// ---------------------------------------------------------------------------

describe('handleBgGetConnectionState', () => {
  test('returns connected=false when not connected', () => {
    const sendResponse = vi.fn();
    handleBgGetConnectionState({}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
  });

  test('returns connected=true after connect', () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    const sendResponse = vi.fn();
    handleBgGetConnectionState({}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
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
    // Simulate service worker wake: wsConnected=true but in-memory caches are empty
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
});
