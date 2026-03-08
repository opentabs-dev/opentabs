import type { ConfigStateBrowserTool, ConfigStateFailedPlugin, ConfigStatePlugin } from '@opentabs-dev/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { DisconnectReason } from './extension-messages.js';

/** Response shape returned by handleBgGetFullState */
interface FullStateResponse {
  connected: boolean;
  disconnectReason?: DisconnectReason;
  plugins: ConfigStatePlugin[];
  failedPlugins: ConfigStateFailedPlugin[];
  browserTools: ConfigStateBrowserTool[];
  browserPermission?: string;
  serverVersion?: string;
  skipPermissions?: boolean;
  pendingConfirmations: unknown[];
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
  mockAddPendingBrowserToolUpdate,
  mockRemovePendingBrowserToolUpdate,
  mockAddPendingAllBrowserToolsUpdate,
  mockRemovePendingAllBrowserToolsUpdate,
  mockAddPendingPluginToolUpdate,
  mockRemovePendingPluginToolUpdate,
  mockAddPendingPluginAllToolsUpdate,
  mockRemovePendingPluginAllToolsUpdate,
  mockAddPendingPluginPermissionUpdate,
  mockRemovePendingPluginPermissionUpdate,
  mockGetPluginMeta,
  mockGetLastSeenUrl,
  mockSetLastSeenUrl,
  mockFindAllMatchingTabs,
  mockGetPendingConfirmations,
} = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
  mockForwardToSidePanel: vi.fn(),
  mockClearTabStateCache: vi.fn(),
  mockStopReadinessPoll: vi.fn(),
  mockGetLastKnownStates: vi.fn(() => new Map<string, string>()),
  mockLoadLastKnownStateFromSession: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockClearAllConfirmationBadges: vi.fn(),
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
  mockAddPendingBrowserToolUpdate: vi.fn(),
  mockRemovePendingBrowserToolUpdate: vi.fn(),
  mockAddPendingAllBrowserToolsUpdate: vi.fn(),
  mockRemovePendingAllBrowserToolsUpdate: vi.fn(),
  mockAddPendingPluginToolUpdate: vi.fn(),
  mockRemovePendingPluginToolUpdate: vi.fn(),
  mockAddPendingPluginAllToolsUpdate: vi.fn(),
  mockRemovePendingPluginAllToolsUpdate: vi.fn(),
  mockAddPendingPluginPermissionUpdate: vi.fn(),
  mockRemovePendingPluginPermissionUpdate: vi.fn(),
  mockGetPluginMeta: vi.fn<(name: string) => Promise<Record<string, unknown> | undefined>>(() =>
    Promise.resolve(undefined),
  ),
  mockGetLastSeenUrl: vi.fn<(name: string) => Promise<string | undefined>>(() => Promise.resolve(undefined)),
  mockSetLastSeenUrl: vi.fn<(name: string, url: string) => Promise<void>>(() => Promise.resolve()),
  mockFindAllMatchingTabs: vi.fn<(meta: unknown) => Promise<chrome.tabs.Tab[]>>(() => Promise.resolve([])),
  mockGetPendingConfirmations: vi.fn<() => unknown[]>(() => []),
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
  clearConfirmationBadge: mockClearConfirmationBadge,
  getPendingConfirmations: mockGetPendingConfirmations,
}));

vi.mock('./message-router.js', () => ({
  handleServerMessage: mockHandleServerMessage,
}));

vi.mock('./tool-dispatch.js', () => ({
  notifyDispatchProgress: mockNotifyDispatchProgress,
}));

vi.mock('./plugin-storage.js', () => ({
  getAllPluginMeta: mockGetAllPluginMeta,
  getPluginMeta: mockGetPluginMeta,
}));

vi.mock('./tab-matching.js', () => ({
  findAllMatchingTabs: mockFindAllMatchingTabs,
}));

vi.mock('./server-state-cache.js', () => ({
  addPendingAllBrowserToolsUpdate: mockAddPendingAllBrowserToolsUpdate,
  addPendingBrowserToolUpdate: mockAddPendingBrowserToolUpdate,
  addPendingPluginAllToolsUpdate: mockAddPendingPluginAllToolsUpdate,
  addPendingPluginPermissionUpdate: mockAddPendingPluginPermissionUpdate,
  addPendingPluginToolUpdate: mockAddPendingPluginToolUpdate,
  getCachesInitialized: mockGetCachesInitialized,
  getServerStateCache: mockGetServerStateCache,
  clearServerStateCache: mockClearServerStateCache,
  loadServerStateCacheFromSession: mockLoadServerStateCacheFromSession,
  removePendingAllBrowserToolsUpdate: mockRemovePendingAllBrowserToolsUpdate,
  removePendingBrowserToolUpdate: mockRemovePendingBrowserToolUpdate,
  removePendingPluginAllToolsUpdate: mockRemovePendingPluginAllToolsUpdate,
  removePendingPluginPermissionUpdate: mockRemovePendingPluginPermissionUpdate,
  removePendingPluginToolUpdate: mockRemovePendingPluginToolUpdate,
  updateServerStateCache: mockUpdateServerStateCache,
}));

vi.mock('./server-request.js', () => ({
  sendServerRequest: mockSendServerRequest,
  rejectAllPendingServerRequests: mockRejectAllPendingServerRequests,
}));

vi.mock('./last-seen-urls.js', () => ({
  getLastSeenUrl: mockGetLastSeenUrl,
  setLastSeenUrl: mockSetLastSeenUrl,
}));

// ---------------------------------------------------------------------------
// Chrome API stubs
// ---------------------------------------------------------------------------

const mockStorageSessionGet = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({});
const mockStorageSessionSet = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockStorageLocalGet = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({});
const mockRuntimeSendMessage = vi.fn(() => Promise.resolve());
const mockTabsUpdate = vi.fn<(tabId: number, props: Record<string, unknown>) => Promise<chrome.tabs.Tab>>(() =>
  Promise.resolve({} as chrome.tabs.Tab),
);
const mockTabsCreate = vi.fn<(props: Record<string, unknown>) => Promise<chrome.tabs.Tab>>(() =>
  Promise.resolve({ id: 999 } as chrome.tabs.Tab),
);
const mockWindowsUpdate = vi.fn<(windowId: number, props: Record<string, unknown>) => Promise<chrome.windows.Window>>(
  () => Promise.resolve({} as chrome.windows.Window),
);

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
  tabs: {
    update: mockTabsUpdate,
    create: mockTabsCreate,
  },
  windows: {
    update: mockWindowsUpdate,
  },
};

const {
  handleWsState,
  handleWsMessage,
  handlePluginLogs,
  handleToolProgress,
  handleSpConfirmationResponse,
  handleBgGetFullState,
  handleBgSetToolPermission,
  handleBgSetAllToolsPermission,
  handleBgSearchPlugins,
  handleBgInstallPlugin,
  handleBgOpenPluginTab,
  handleBgRemovePlugin,
  handleBgUpdatePlugin,
  initBackgroundMessageHandlers,
  restoreWsConnectedState,
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
      params: {
        dispatchId: 'abc',
        progress: 5,
        total: 10,
        message: 'Processing...',
      },
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
      browserPermission: undefined,
      serverVersion: undefined,
      skipPermissions: undefined,
      pendingConfirmations: [],
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
        permission: 'off',
        urlPatterns: ['https://example.com/*'],
        tools: [
          {
            name: 'test_tool',
            displayName: 'Test Tool',
            description: 'A test tool',
          },
        ],
        iconSvg: '<svg/>',
      },
    });

    mockGetServerStateCache.mockReturnValueOnce({
      plugins: [
        {
          name: 'test-plugin',
          displayName: 'Test Plugin',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: ['https://example.com/*'],
          sdkVersion: '2.0.0',
          tools: [
            {
              name: 'test_tool',
              displayName: 'Test Tool',
              description: 'A test tool',
              permission: 'off',
            },
          ],
        },
      ],
      failedPlugins: [{ specifier: 'bad-plugin', error: 'load failed' }],
      browserTools: [{ name: 'screenshot', description: 'Take a screenshot', permission: 'auto' }],
      serverVersion: '1.2.3',
    });

    mockGetLastKnownStates.mockReturnValueOnce(
      new Map([
        [
          'test-plugin',
          JSON.stringify({
            state: 'ready',
            tabs: [
              {
                tabId: 1,
                url: 'https://example.com',
                title: 'Example',
                ready: true,
              },
            ],
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
        browserTools: [
          {
            name: 'screenshot',
            description: 'Take a screenshot',
            permission: 'auto',
          },
        ],
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
    expect(result.plugins[0]?.tools[0]).toMatchObject({ permission: 'off' });
  });

  test('includes dark icon fields from plugin metadata in merged output', async () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'icon-plugin': {
        name: 'icon-plugin',
        displayName: 'Icon Plugin',
        version: '1.0.0',
        permission: 'off',
        urlPatterns: ['https://example.com/*'],
        tools: [
          {
            name: 'do_thing',
            displayName: 'Do Thing',
            description: 'Does a thing',
          },
        ],
        iconSvg: '<svg>light</svg>',
        iconInactiveSvg: '<svg>light-inactive</svg>',
        iconDarkSvg: '<svg>dark</svg>',
        iconDarkInactiveSvg: '<svg>dark-inactive</svg>',
        sourcePath: '/private/path/to/plugin',
        adapterHash: 'abc123',
        adapterFile: 'adapter.iife.js',
      },
    });

    mockGetServerStateCache.mockReturnValueOnce({
      plugins: [
        {
          name: 'icon-plugin',
          displayName: 'Icon Plugin',
          version: '1.0.0',
          permission: 'off',
          source: 'local',
          tabState: 'closed',
          urlPatterns: ['https://example.com/*'],
          tools: [
            {
              name: 'do_thing',
              displayName: 'Do Thing',
              description: 'Does a thing',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.plugins).toHaveLength(1);
    const outputPlugin = result.plugins[0];
    expect(outputPlugin).toMatchObject({
      name: 'icon-plugin',
      iconSvg: '<svg>light</svg>',
      iconInactiveSvg: '<svg>light-inactive</svg>',
      iconDarkSvg: '<svg>dark</svg>',
      iconDarkInactiveSvg: '<svg>dark-inactive</svg>',
    });

    // Internal-only PluginMeta fields must NOT leak to the side panel
    expect(outputPlugin).not.toHaveProperty('adapterHash');
    expect(outputPlugin).not.toHaveProperty('adapterFile');
  });

  test('prefers server cache plugin-level permission over stale meta', async () => {
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'test-plugin': {
        name: 'test-plugin',
        displayName: 'Test Plugin',
        version: '1.0.0',
        permission: 'off', // stale meta value
        urlPatterns: ['https://example.com/*'],
        tools: [{ name: 'my_tool', displayName: 'My Tool', description: 'desc' }],
      },
    });

    mockGetServerStateCache.mockReturnValueOnce({
      plugins: [
        {
          name: 'test-plugin',
          displayName: 'Test Plugin',
          version: '1.0.0',
          permission: 'auto', // updated server value
          source: 'npm',
          tabState: 'closed',
          urlPatterns: ['https://example.com/*'],
          tools: [{ name: 'my_tool', displayName: 'My Tool', description: 'desc', permission: 'ask' }],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.permission).toBe('auto');
    expect(result.plugins[0]?.tools[0]).toMatchObject({ permission: 'ask' });
  });

  test('defaults tool permission to auto when server cache is empty', async () => {
    mockGetAllPluginMeta.mockResolvedValueOnce({
      'test-plugin': {
        name: 'test-plugin',
        displayName: 'Test Plugin',
        version: '1.0.0',
        permission: 'off',
        urlPatterns: [],
        tools: [{ name: 'my_tool', displayName: 'My Tool', description: 'desc', permission: 'auto' }],
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
    expect(result.plugins[0]?.tools[0]).toMatchObject({ permission: 'auto' });
  });

  test('loads from session storage on service worker wake (connected but empty caches)', async () => {
    // Simulate service worker wake: wsConnected=true but in-memory caches are empty.
    // After suspension, cachesInitialized resets to false in memory but is true in
    // session storage (sync.full ran before suspension). loadServerStateCacheFromSession
    // restores both the cache data AND cachesInitialized, then tab state is loaded.
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
    // In-memory cachesInitialized starts false (reset by suspension)
    mockGetCachesInitialized.mockReturnValue(false);

    // loadServerStateCacheFromSession restores both cache data and cachesInitialized
    mockLoadServerStateCacheFromSession.mockImplementationOnce(() => {
      mockGetCachesInitialized.mockReturnValue(true);
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          {
            name: 'restored-plugin',
            displayName: 'Restored Plugin',
            version: '1.0.0',
            permission: 'off',
            source: 'npm',
            tabState: 'closed',
            urlPatterns: [],
            sdkVersion: '2.0.0',
            tools: [
              {
                name: 'tool_a',
                displayName: 'Tool A',
                description: 'desc',
                permission: 'off',
              },
            ],
          },
        ],
        failedPlugins: [],
        browserTools: [
          {
            name: 'screenshot',
            description: 'Take a screenshot',
            permission: 'auto',
          },
        ],
        serverVersion: '3.0.0',
      });
      return Promise.resolve();
    });

    // After cachesInitialized is restored to true, tab state is loaded
    mockLoadLastKnownStateFromSession.mockImplementationOnce(() => {
      mockGetLastKnownStates.mockReturnValue(
        new Map([
          [
            'restored-plugin',
            JSON.stringify({
              state: 'ready',
              tabs: [
                {
                  tabId: 5,
                  url: 'https://restored.com',
                  title: 'Restored',
                  ready: true,
                },
              ],
            }),
          ],
        ]),
      );
      return Promise.resolve();
    });

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'restored-plugin': {
        name: 'restored-plugin',
        displayName: 'Restored Plugin',
        version: '1.0.0',
        permission: 'off',
        urlPatterns: [],
        tools: [{ name: 'tool_a', displayName: 'Tool A', description: 'desc' }],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Server state cache loaded first (restores cachesInitialized), then tab state
    expect(mockLoadServerStateCacheFromSession).toHaveBeenCalledOnce();
    expect(mockLoadLastKnownStateFromSession).toHaveBeenCalledOnce();

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
    expect(result.plugins[0]?.tools[0]).toMatchObject({ permission: 'off' });
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
          permission: 'off',
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
        permission: 'off',
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

  test('does NOT restore tab state during connect-to-sync.full gap (cachesInitialized=false after session load)', async () => {
    // Simulate the false positive: WebSocket just connected (wsConnected=true) but
    // sync.full has not arrived yet (cachesInitialized=false in session, caches empty).
    // The server state cache is loaded from session (to restore cachesInitialized),
    // but since cachesInitialized remains false, tab state is NOT restored.
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetLastKnownStates.mockReturnValue(new Map());
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
    // cachesInitialized stays false even after session load (sync.full never ran)
    mockGetCachesInitialized.mockReturnValue(false);
    mockGetAllPluginMeta.mockResolvedValueOnce({});

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Server state cache IS loaded from session (to restore cachesInitialized flag)
    expect(mockLoadServerStateCacheFromSession).toHaveBeenCalledOnce();
    // Tab state must NOT be loaded — cachesInitialized is false after session load
    expect(mockLoadLastKnownStateFromSession).not.toHaveBeenCalled();

    // Response should return empty plugins (no stale data restored)
    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
    expect(result.plugins).toEqual([]);
  });

  test('loads from session storage after sync.full + suspension (cachesInitialized restored from session)', async () => {
    // Simulate real wake: sync.full already ran (cachesInitialized=true in session),
    // then service worker was suspended. On wake, in-memory caches are empty AND
    // cachesInitialized is false (module default). loadServerStateCacheFromSession
    // restores cachesInitialized=true from session, enabling tab state restoration.
    handleWsState({ connected: true }, () => {});
    vi.clearAllMocks();

    mockGetLastKnownStates.mockReturnValue(new Map());
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
    });
    // In-memory cachesInitialized starts false (reset by suspension)
    mockGetCachesInitialized.mockReturnValue(false);

    // loadServerStateCacheFromSession restores cachesInitialized=true from session
    mockLoadServerStateCacheFromSession.mockImplementationOnce(() => {
      mockGetCachesInitialized.mockReturnValue(true);
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          {
            name: 'wake-plugin',
            displayName: 'Wake Plugin',
            version: '1.0.0',
            permission: 'off',
            source: 'local',
            tabState: 'closed',
            urlPatterns: [],
            tools: [
              {
                name: 'tool_x',
                displayName: 'Tool X',
                description: 'desc',
                permission: 'auto',
              },
            ],
          },
        ],
        failedPlugins: [],
        browserTools: [],
        serverVersion: '5.0.0',
      });
      return Promise.resolve();
    });

    mockLoadLastKnownStateFromSession.mockImplementationOnce(() => {
      mockGetLastKnownStates.mockReturnValue(new Map([['wake-plugin', JSON.stringify({ state: 'ready', tabs: [] })]]));
      return Promise.resolve();
    });

    mockGetAllPluginMeta.mockResolvedValueOnce({
      'wake-plugin': {
        name: 'wake-plugin',
        displayName: 'Wake Plugin',
        version: '1.0.0',
        permission: 'off',
        urlPatterns: [],
        tools: [{ name: 'tool_x', displayName: 'Tool X', description: 'desc' }],
      },
    });

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Server state loaded first (restores cachesInitialized), then tab state
    expect(mockLoadServerStateCacheFromSession).toHaveBeenCalledOnce();
    expect(mockLoadLastKnownStateFromSession).toHaveBeenCalledOnce();

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
    expect(result.serverVersion).toBe('5.0.0');
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      name: 'wake-plugin',
      tabState: 'ready',
    });
  });

  test('returns connected=true when session storage has wsConnected=true but in-memory flag not yet restored', async () => {
    // Simulate the wake race: service worker woke up, restoreWsConnectedState() was
    // called but the async session read hasn't resolved yet when bg:getFullState arrives.
    // handleBgGetFullState must await waitForWsConnectedRestore() so the in-memory
    // wsConnected is updated before it is read.
    //
    // Set up session storage to return wsConnected=true, then call
    // restoreWsConnectedState() to start the async restore. At this point,
    // wsConnected (in-memory) is still false. handleBgGetFullState must see true.
    mockStorageSessionGet.mockResolvedValueOnce({ wsConnected: true });
    restoreWsConnectedState();

    mockGetAllPluginMeta.mockResolvedValueOnce({});

    const sendResponse = vi.fn();
    handleBgGetFullState({}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const result = sendResponse.mock.calls.at(0)?.at(0) as FullStateResponse;
    expect(result.connected).toBe(true);
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

describe('handleBgSetToolPermission', () => {
  test('optimistically updates server state cache and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    // Optimistic update should have been called
    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      plugins: Array<{ tools: Array<{ permission: string }> }>;
    };
    expect(updateCall.plugins[0]?.tools[0]?.permission).toBe('off');

    // sendServerRequest should have been called
    expect(mockSendServerRequest).toHaveBeenCalledWith('config.setToolPermission', {
      plugin: 'slack',
      tool: 'send',
      permission: 'off',
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
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Should have been called twice: optimistic + revert
    expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(2);
    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{ tools: Array<{ permission: string }> }>;
    };
    expect(revertCall.plugins[0]?.tools[0]?.permission).toBe('auto');

    expect(sendResponse).toHaveBeenCalledWith({ error: 'Server error' });
  });

  test('revert restores exact pre-mutation state, not toggled permission', async () => {
    // Tool starts off. Calling with permission: 'off' (same value) must revert to off,
    // not flip to auto as a naive toggle approach would do.
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'off',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{ tools: Array<{ permission: string }> }>;
    };
    // Must restore original permission: 'off', not flip to true
    expect(revertCall.plugins[0]?.tools[0]?.permission).toBe('off');
  });

  test('registers pending optimistic update before cache update and clears on success', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    // Pending update registered before the cache update
    expect(mockAddPendingPluginToolUpdate).toHaveBeenCalledWith('slack', 'send', 'off');

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Pending update cleared on success
    expect(mockRemovePendingPluginToolUpdate).toHaveBeenCalledWith('slack', 'send');
  });

  test('clears pending optimistic update on server error before reverting', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    // Pending update cleared before revert
    expect(mockRemovePendingPluginToolUpdate).toHaveBeenCalledWith('slack', 'send');
  });

  test('rollback only reverts the target tool, not other tools or plugins', async () => {
    const initialCache = {
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'closed' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
            {
              name: 'read',
              displayName: 'Read',
              description: 'desc',
              permission: 'off',
            },
          ],
        },
        {
          name: 'github',
          displayName: 'GitHub',
          version: '2.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'ready' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'create_issue',
              displayName: 'Create Issue',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };
    mockGetServerStateCache.mockReturnValue(initialCache);

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{
        name: string;
        tools: Array<{ name: string; permission: string }>;
      }>;
    };
    // Target tool reverted to original value
    const slackPlugin = revertCall.plugins.find(p => p.name === 'slack');
    expect(slackPlugin?.tools.find(t => t.name === 'send')?.permission).toBe('auto');
    // Other tool in same plugin untouched
    expect(slackPlugin?.tools.find(t => t.name === 'read')?.permission).toBe('off');
    // Other plugin untouched
    const githubPlugin = revertCall.plugins.find(p => p.name === 'github');
    expect(githubPlugin?.tools.find(t => t.name === 'create_issue')?.permission).toBe('auto');
  });

  test('rollback preserves concurrent plugins.changed updates', async () => {
    // Initial state: slack send has permission auto
    const initialCache = {
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'closed' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };

    // Simulate concurrent plugins.changed adding a new plugin between optimistic update
    // and rollback. The second getServerStateCache call returns updated state.
    const concurrentUpdatedCache = {
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'closed' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'off',
            },
          ],
        },
        {
          name: 'github',
          displayName: 'GitHub',
          version: '2.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'ready' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'create_issue',
              displayName: 'Create Issue',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };

    // First call: initial state (read at handler start)
    // Second call: concurrent-updated state (read during rollback)
    mockGetServerStateCache.mockReturnValueOnce(initialCache).mockReturnValueOnce(concurrentUpdatedCache);

    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetToolPermission({ plugin: 'slack', tool: 'send', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{
        name: string;
        tools: Array<{ name: string; permission: string }>;
      }>;
    };
    // Target tool reverted to original (true), not the concurrent value (false)
    expect(revertCall.plugins.find(p => p.name === 'slack')?.tools[0]?.permission).toBe('auto');
    // Concurrent new plugin (github) preserved in the rollback
    expect(revertCall.plugins.find(p => p.name === 'github')).toBeDefined();
    expect(revertCall.plugins).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// bg:setAllToolsEnabled
// ---------------------------------------------------------------------------

describe('handleBgSetAllToolsPermission', () => {
  test('optimistically updates all tools and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
            {
              name: 'read',
              displayName: 'Read',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'slack', permission: 'off' }, sendResponse);

    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      plugins: Array<{ tools: Array<{ permission: string }> }>;
    };
    expect(updateCall.plugins[0]?.tools.every(t => t.permission === 'off')).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test('registers pending optimistic updates for all tools and clears on success', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off',
          source: 'npm',
          tabState: 'closed',
          urlPatterns: [],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
            {
              name: 'read',
              displayName: 'Read',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'slack', permission: 'off' }, sendResponse);

    expect(mockAddPendingPluginAllToolsUpdate).toHaveBeenCalledWith('slack', ['send', 'read'], 'off');

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(mockRemovePendingPluginAllToolsUpdate).toHaveBeenCalledWith('slack', ['send', 'read']);
  });

  test('rollback preserves concurrent plugins.changed and only reverts target plugin tools', async () => {
    const initialCache = {
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'closed' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'auto',
            },
            {
              name: 'read',
              displayName: 'Read',
              description: 'desc',
              permission: 'off',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };

    // Concurrent update adds a new plugin
    const concurrentCache = {
      plugins: [
        {
          name: 'slack',
          displayName: 'Slack',
          version: '1.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'closed' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'send',
              displayName: 'Send',
              description: 'desc',
              permission: 'off',
            },
            {
              name: 'read',
              displayName: 'Read',
              description: 'desc',
              permission: 'off',
            },
          ],
        },
        {
          name: 'github',
          displayName: 'GitHub',
          version: '2.0.0',
          permission: 'off' as const,
          source: 'npm' as const,
          tabState: 'ready' as const,
          urlPatterns: [] as string[],
          tools: [
            {
              name: 'create_issue',
              displayName: 'Create Issue',
              description: 'desc',
              permission: 'auto',
            },
          ],
        },
      ],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };

    mockGetServerStateCache.mockReturnValueOnce(initialCache).mockReturnValueOnce(concurrentCache);
    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'slack', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      plugins: Array<{
        name: string;
        tools: Array<{ name: string; permission: string }>;
      }>;
    };
    // Target plugin tools reverted to original values
    const slackPlugin = revertCall.plugins.find(p => p.name === 'slack');
    expect(slackPlugin?.tools.find(t => t.name === 'send')?.permission).toBe('auto');
    expect(slackPlugin?.tools.find(t => t.name === 'read')?.permission).toBe('off');
    // Concurrent new plugin preserved
    expect(revertCall.plugins.find(p => p.name === 'github')).toBeDefined();
    expect(revertCall.plugins).toHaveLength(2);
  });

  test('plugin=browser: optimistically updates browserTools and calls sendServerRequest', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'browser_screenshot', displayName: 'Screenshot', description: 'desc', permission: 'auto' },
        { name: 'browser_click', displayName: 'Click', description: 'desc', permission: 'ask' },
      ],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'browser', permission: 'off' }, sendResponse);

    expect(mockUpdateServerStateCache).toHaveBeenCalledOnce();
    const updateCall = mockUpdateServerStateCache.mock.calls[0]?.[0] as {
      browserTools: Array<{ permission: string }>;
    };
    expect(updateCall.browserTools.every(t => t.permission === 'off')).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  test('plugin=browser: registers pending updates and clears on success', async () => {
    mockGetServerStateCache.mockReturnValue({
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'browser_screenshot', displayName: 'Screenshot', description: 'desc', permission: 'auto' },
        { name: 'browser_click', displayName: 'Click', description: 'desc', permission: 'ask' },
      ],
      serverVersion: '1.0.0',
    });

    mockSendServerRequest.mockResolvedValueOnce({ ok: true });

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'browser', permission: 'off' }, sendResponse);

    expect(mockAddPendingAllBrowserToolsUpdate).toHaveBeenCalledWith(['browser_screenshot', 'browser_click'], 'off');

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(mockRemovePendingAllBrowserToolsUpdate).toHaveBeenCalledWith(['browser_screenshot', 'browser_click']);
  });

  test('plugin=browser: error rollback reverts browserTools to original permissions', async () => {
    const initialCache = {
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'browser_screenshot', displayName: 'Screenshot', description: 'desc', permission: 'auto' as const },
        { name: 'browser_click', displayName: 'Click', description: 'desc', permission: 'ask' as const },
      ],
      serverVersion: '1.0.0',
    };

    const concurrentCache = {
      plugins: [],
      failedPlugins: [],
      browserTools: [
        { name: 'browser_screenshot', displayName: 'Screenshot', description: 'desc', permission: 'off' as const },
        { name: 'browser_click', displayName: 'Click', description: 'desc', permission: 'off' as const },
      ],
      serverVersion: '1.0.0',
    };

    mockGetServerStateCache.mockReturnValueOnce(initialCache).mockReturnValueOnce(concurrentCache);
    mockSendServerRequest.mockRejectedValueOnce(new Error('Server error'));

    const sendResponse = vi.fn();
    handleBgSetAllToolsPermission({ plugin: 'browser', permission: 'off' }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    const revertCall = mockUpdateServerStateCache.mock.calls[1]?.[0] as {
      browserTools: Array<{ name: string; permission: string }>;
    };
    expect(revertCall.browserTools.find(t => t.name === 'browser_screenshot')?.permission).toBe('auto');
    expect(revertCall.browserTools.find(t => t.name === 'browser_click')?.permission).toBe('ask');
  });
});

// ---------------------------------------------------------------------------
// bg:searchPlugins
// ---------------------------------------------------------------------------

describe('handleBgSearchPlugins', () => {
  test('relays plugin.search to the server and returns results', async () => {
    const results = {
      results: [{ name: 'opentabs-plugin-test', description: 'test', version: '1.0.0' }],
    };
    mockSendServerRequest.mockResolvedValueOnce(results);

    const sendResponse = vi.fn();
    handleBgSearchPlugins({ query: 'test' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.search', {
      query: 'test',
    });

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
    const result = {
      ok: true,
      plugin: {
        name: 'test',
        displayName: 'Test',
        version: '1.0.0',
        toolCount: 2,
      },
    };
    mockSendServerRequest.mockResolvedValueOnce(result);

    const sendResponse = vi.fn();
    handleBgInstallPlugin({ name: 'opentabs-plugin-test' }, sendResponse);

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.install', {
      name: 'opentabs-plugin-test',
    });

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

    expect(mockSendServerRequest).toHaveBeenCalledWith('plugin.remove', {
      name: 'test-plugin',
    });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// bg:updatePlugin
// ---------------------------------------------------------------------------

describe('handleBgUpdatePlugin', () => {
  test('relays plugin.updateFromRegistry to the server and returns result', async () => {
    const result = {
      ok: true,
      plugin: {
        name: 'test',
        displayName: 'Test',
        version: '2.0.0',
        toolCount: 3,
      },
    };
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

// ---------------------------------------------------------------------------
// EXTENSION_ONLY_TYPES security guard
// ---------------------------------------------------------------------------

describe('EXTENSION_ONLY_TYPES security guard', () => {
  type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

  /** Install a chrome.runtime.onMessage mock that captures registered listeners */
  const installListenerCapture = (): Listener[] => {
    const listeners: Listener[] = [];
    const chromeGlobal = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
    chromeGlobal.runtime = {
      ...(chromeGlobal.runtime as Record<string, unknown>),
      onMessage: {
        addListener: (fn: Listener) => {
          listeners.push(fn);
        },
      },
    };
    return listeners;
  };

  test('rejects extension-only messages from non-extension senders', () => {
    const listeners = installListenerCapture();
    initBackgroundMessageHandlers();

    expect(listeners).toHaveLength(1);
    const listener = listeners[0] as Listener;
    const sendResponse = vi.fn();

    // Sender.id differs from chrome.runtime.id — simulates a malicious extension
    const result = listener(
      { type: 'bg:setToolEnabled' },
      { id: 'malicious-extension-id', url: 'https://evil.com' },
      sendResponse,
    );

    // Should return false (reject) and NOT call sendResponse
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test('accepts extension-only messages from the extension itself', () => {
    const listeners = installListenerCapture();
    initBackgroundMessageHandlers();

    expect(listeners).toHaveLength(1);
    const listener = listeners[0] as Listener;
    const sendResponse = vi.fn();

    // Sender.id matches chrome.runtime.id — trusted extension context
    const result = listener({ type: 'bg:getFullState' }, { id: 'test-extension-id' }, sendResponse);

    // Should return true (accepted and handled asynchronously)
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleBgOpenPluginTab (and pickNextTab indirectly)
// ---------------------------------------------------------------------------

describe('handleBgOpenPluginTab', () => {
  /** Helper to invoke the handler and capture the response via a promise. */
  const callOpenPluginTab = (pluginName?: string): Promise<Record<string, unknown>> =>
    new Promise(resolve => {
      handleBgOpenPluginTab({ pluginName } as Record<string, unknown>, resolve as (response: unknown) => void);
    });

  /** Build a minimal PluginMeta-like object accepted by getPluginMeta mock. */
  const makeMeta = (name: string, homepage?: string) => ({
    name,
    homepage,
    tools: [],
    urlPatterns: ['*://example.com/*'],
  });

  /** Build a chrome.tabs.Tab stub with the given id, windowId, and active flag. */
  const makeTab = (id: number, windowId: number, active = false): chrome.tabs.Tab =>
    ({ id, windowId, active, url: 'https://example.com' }) as chrome.tabs.Tab;

  test('returns { opened: false } when pluginName is missing', async () => {
    const result = await callOpenPluginTab(undefined);
    expect(result).toEqual({ opened: false });
  });

  test('returns { opened: false } when plugin meta not found', async () => {
    mockGetPluginMeta.mockResolvedValueOnce(undefined);
    const result = await callOpenPluginTab('unknown-plugin');
    expect(result).toEqual({ opened: false });
  });

  test('with one matching tab: calls chrome.tabs.update and chrome.windows.update', async () => {
    const meta = makeMeta('single-tab-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(10, 1)]);

    const result = await callOpenPluginTab('single-tab-plugin');

    expect(mockTabsUpdate).toHaveBeenCalledWith(10, { active: true });
    expect(mockWindowsUpdate).toHaveBeenCalledWith(1, { focused: true });
    expect(result).toEqual({ opened: true, tabId: 10 });
  });

  test('first call with active tab among matches: focuses a non-active tab', async () => {
    // Tab 20 is active (the user's current tab), tab 30 is not.
    // pickNextTab first-click logic picks the first non-active tab.
    const meta = makeMeta('first-click-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(20, 1, true), makeTab(30, 1, false)]);

    const result = await callOpenPluginTab('first-click-plugin');

    // Should focus tab 30 (non-active), not tab 20 (already active)
    expect(mockTabsUpdate).toHaveBeenCalledWith(30, { active: true });
    expect(result).toEqual({ opened: true, tabId: 30 });
  });

  test('with two tabs: cycles between them on repeated calls (not always the same tab)', async () => {
    // Use a unique plugin name so lastFocusedTabId state doesn't leak from other tests
    const meta = makeMeta('cycle-2-tabs-plugin');
    const tab1 = makeTab(100, 1, true);
    const tab2 = makeTab(200, 1, false);

    // Call 1: first click picks non-active tab (200)
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2]);
    const result1 = await callOpenPluginTab('cycle-2-tabs-plugin');
    expect(result1).toEqual({ opened: true, tabId: 200 });

    // Call 2: round-robin advances past 200 → wraps to 100
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2]);
    vi.clearAllMocks();
    // Reset wsConnected state (clearAllMocks doesn't reset module state)
    const result2 = await callOpenPluginTab('cycle-2-tabs-plugin');
    expect(result2).toEqual({ opened: true, tabId: 100 });

    // Call 3: round-robin advances past 100 → wraps to 200
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2]);
    const result3 = await callOpenPluginTab('cycle-2-tabs-plugin');
    expect(result3).toEqual({ opened: true, tabId: 200 });
  });

  test('pickNextTab wraps around to the first tab after reaching the end', async () => {
    // Three tabs: 10, 20, 30. First call picks non-active (20 is first non-active).
    // Subsequent calls cycle: 30, 10, 20, 30, ...
    const meta = makeMeta('wrap-around-plugin');
    const tab1 = makeTab(10, 1, true);
    const tab2 = makeTab(20, 1, false);
    const tab3 = makeTab(30, 1, false);

    // Call 1: picks first non-active → tab 20
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2, tab3]);
    const r1 = await callOpenPluginTab('wrap-around-plugin');
    expect(r1).toEqual({ opened: true, tabId: 20 });

    // Call 2: advances past 20 → tab 30
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2, tab3]);
    const r2 = await callOpenPluginTab('wrap-around-plugin');
    expect(r2).toEqual({ opened: true, tabId: 30 });

    // Call 3: advances past 30 → wraps to tab 10
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([tab1, tab2, tab3]);
    const r3 = await callOpenPluginTab('wrap-around-plugin');
    expect(r3).toEqual({ opened: true, tabId: 10 });
  });

  test('pickNextTab first call when all tabs are inactive picks the first tab', async () => {
    const meta = makeMeta('all-inactive-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    // All tabs are inactive — find(t => !t.tab.active) returns the first one
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(5, 1, false), makeTab(15, 1, false)]);

    const result = await callOpenPluginTab('all-inactive-plugin');
    expect(result).toEqual({ opened: true, tabId: 5 });
  });

  test('pickNextTab first call when only one tab exists and it is active picks that tab', async () => {
    const meta = makeMeta('single-active-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(42, 1, true)]);

    const result = await callOpenPluginTab('single-active-plugin');
    expect(result).toEqual({ opened: true, tabId: 42 });
  });

  test('pickNextTab with empty array returns undefined (falls through to homepage)', async () => {
    const meta = makeMeta('empty-tabs-hp-plugin', 'https://example.com');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([]);

    const result = await callOpenPluginTab('empty-tabs-hp-plugin');

    expect(mockTabsUpdate).not.toHaveBeenCalled();
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(result).toEqual({ opened: true, tabId: 999 });
  });

  test('handles lastFocusedTabId pointing to a tab that no longer exists (removed mid-cycle)', async () => {
    // Setup: prime lastFocusedTabId by making a first call with tabs 50, 60
    const meta = makeMeta('removed-tab-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(50, 1, false), makeTab(60, 1, false)]);
    const r1 = await callOpenPluginTab('removed-tab-plugin');
    expect(r1).toEqual({ opened: true, tabId: 50 });

    // Now tab 50 is gone. Only tab 60 remains. lastFocusedTabId=50, findIndex returns -1,
    // so (-1 + 1) % 1 = 0 → picks sorted[0] which is tab 60.
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([makeTab(60, 1, false)]);
    const r2 = await callOpenPluginTab('removed-tab-plugin');
    expect(r2).toEqual({ opened: true, tabId: 60 });
  });

  test('with no matching tabs and homepage: calls chrome.tabs.create with the homepage URL', async () => {
    const meta = makeMeta('homepage-plugin', 'https://myhomepage.com');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([]);

    const result = await callOpenPluginTab('homepage-plugin');

    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://myhomepage.com' });
    expect(result).toEqual({ opened: true, tabId: 999 });
  });

  test('with no matching tabs, no homepage, and no last-seen URL: returns { opened: false }', async () => {
    const meta = makeMeta('no-homepage-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([]);
    mockGetLastSeenUrl.mockResolvedValueOnce(undefined);

    const result = await callOpenPluginTab('no-homepage-plugin');

    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ opened: false });
  });

  test('tabs without IDs are filtered out before cycling', async () => {
    const meta = makeMeta('no-id-tabs-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    // One tab with id, one without — only the one with id should be considered
    mockFindAllMatchingTabs.mockResolvedValueOnce([
      { windowId: 1, active: false, url: 'https://example.com' } as chrome.tabs.Tab,
      makeTab(77, 1, false),
    ]);

    const result = await callOpenPluginTab('no-id-tabs-plugin');
    expect(result).toEqual({ opened: true, tabId: 77 });
  });

  test('falls back to last-seen URL when no tabs and no homepage', async () => {
    const meta = makeMeta('last-seen-plugin');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([]);
    mockGetLastSeenUrl.mockResolvedValueOnce('https://myteam.atlassian.net/browse/PROJ-1');

    const result = await callOpenPluginTab('last-seen-plugin');

    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://myteam.atlassian.net/browse/PROJ-1' });
    expect(result).toEqual({ opened: true, tabId: 999 });
  });

  test('prefers homepage over last-seen URL', async () => {
    const meta = makeMeta('homepage-pref-plugin', 'https://app.slack.com');
    mockGetPluginMeta.mockResolvedValueOnce(meta);
    mockFindAllMatchingTabs.mockResolvedValueOnce([]);
    mockGetLastSeenUrl.mockResolvedValueOnce('https://app.slack.com/client/T123');

    const result = await callOpenPluginTab('homepage-pref-plugin');

    // Should open homepage, not last-seen URL
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://app.slack.com' });
    expect(result).toEqual({ opened: true, tabId: 999 });
  });
});
