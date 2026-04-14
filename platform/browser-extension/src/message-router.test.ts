import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ValidatedPluginPayload } from './message-router.js';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing message-router.js so that
// handleServerMessage's internal references bind to the mocked versions.
//
// Only mock modules that have NO separate test file in this directory.
// Modules with their own test files (plugin-storage, tab-matching) are NOT
// mocked here to avoid contaminating their tests when Vitest runs all test
// files in the same process.
// ---------------------------------------------------------------------------

const {
  mockSendToServer,
  mockForwardToSidePanel,
  mockSendTabStateNotification,
  mockHandleToolDispatch,
  mockHandleBrowserListTabs,
  mockHandleBrowserOpenTab,
  mockHandleBrowserCloseTab,
  mockHandleBrowserNavigateTab,
  mockHandleBrowserFocusTab,
  mockHandleBrowserGetTabInfo,
  mockHandleBrowserListTabGroups,
  mockHandleBrowserCreateTabGroup,
  mockHandleBrowserAddTabsToGroup,
  mockHandleBrowserRemoveTabsFromGroup,
  mockHandleBrowserUpdateTabGroup,
  mockHandleBrowserListTabsInGroup,
  mockHandleBrowserGetTabContent,
  mockHandleBrowserGetPageHtml,
  mockHandleBrowserGetStorage,
  mockHandleBrowserScreenshotTab,
  mockHandleBrowserClickElement,
  mockHandleBrowserTypeText,
  mockHandleBrowserSelectOption,
  mockHandleBrowserWaitForElement,
  mockHandleBrowserQueryElements,
  mockHandleBrowserGetCookies,
  mockHandleBrowserSetCookie,
  mockHandleBrowserDeleteCookies,
  mockHandleBrowserEnableNetworkCapture,
  mockHandleBrowserGetNetworkRequests,
  mockHandleBrowserGetWebSocketFrames,
  mockHandleBrowserDisableNetworkCapture,
  mockHandleBrowserGetConsoleLogs,
  mockHandleBrowserClearConsoleLogs,
  mockHandleBrowserExecuteScript,
  mockHandleBrowserListResources,
  mockHandleBrowserGetResourceContent,
  mockHandleBrowserPressKey,
  mockHandleBrowserScroll,
  mockHandleBrowserHoverElement,
  mockHandleBrowserHandleDialog,
  mockHandleBrowserShowNotification,
  mockHandleBrowserListWindows,
  mockHandleBrowserCreateWindow,
  mockHandleBrowserUpdateWindow,
  mockHandleBrowserCloseWindow,
  mockHandleBrowserDownloadFile,
  mockHandleBrowserListDownloads,
  mockHandleBrowserGetDownloadStatus,
  mockHandleExtensionGetState,
  mockHandleExtensionGetLogs,
  mockHandleExtensionGetSidePanel,
  mockHandleExtensionCheckAdapter,
  mockHandleExtensionForceReconnect,
  mockNotifyConfirmationRequest,
  mockUpdateServerStateCache,
  mockGetServerStateCache,
  mockSendTabSyncAll,
  mockStartReadinessPoll,
  mockGetLastKnownStates,
  mockLoadLastKnownStateFromSession,
} = vi.hoisted(() => {
  const asyncNoop = () => Promise.resolve();
  const syncNoop = (() => {}) as (params: Record<string, unknown>, id: string | number) => void;

  return {
    asyncNoop,
    syncNoop,
    mockSendToServer: vi.fn<(data: unknown) => void>(),
    mockForwardToSidePanel: vi.fn<(message: unknown) => void>(),
    mockSendTabStateNotification: vi.fn<(pluginName: string, stateInfo: unknown) => void>(),
    mockHandleToolDispatch: vi.fn(asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>),
    mockHandleBrowserListTabs: vi.fn(asyncNoop as (id: string | number) => Promise<void>),
    mockHandleBrowserOpenTab: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserCloseTab: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserNavigateTab: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserFocusTab: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetTabInfo: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserListTabGroups: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserCreateTabGroup: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserAddTabsToGroup: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserRemoveTabsFromGroup: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserUpdateTabGroup: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserListTabsInGroup: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetTabContent: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetPageHtml: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetStorage: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserScreenshotTab: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserClickElement: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserTypeText: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserSelectOption: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserWaitForElement: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserQueryElements: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetCookies: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserSetCookie: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserDeleteCookies: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserEnableNetworkCapture: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetNetworkRequests: vi.fn(syncNoop),
    mockHandleBrowserGetWebSocketFrames: vi.fn(syncNoop),
    mockHandleBrowserDisableNetworkCapture: vi.fn(syncNoop),
    mockHandleBrowserGetConsoleLogs: vi.fn(syncNoop),
    mockHandleBrowserClearConsoleLogs: vi.fn(syncNoop),
    mockHandleBrowserExecuteScript: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserListResources: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetResourceContent: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserPressKey: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserScroll: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserHoverElement: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserHandleDialog: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserShowNotification: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserListWindows: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserCreateWindow: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserUpdateWindow: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserCloseWindow: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserDownloadFile: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserListDownloads: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleBrowserGetDownloadStatus: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleExtensionGetState: vi.fn(asyncNoop as (id: string | number) => Promise<void>),
    mockHandleExtensionGetLogs: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleExtensionGetSidePanel: vi.fn(asyncNoop as (id: string | number) => Promise<void>),
    mockHandleExtensionCheckAdapter: vi.fn(
      asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
    ),
    mockHandleExtensionForceReconnect: vi.fn(asyncNoop as (id: string | number) => Promise<void>),
    mockNotifyConfirmationRequest: vi.fn<(params: Record<string, unknown>) => void>(),
    mockUpdateServerStateCache: vi.fn<(partial: Record<string, unknown>) => void>(),
    mockGetServerStateCache: vi.fn(
      () =>
        ({
          plugins: [],
          failedPlugins: [],
          browserTools: [],
          serverVersion: undefined,
        }) as {
          plugins: Record<string, unknown>[];
          failedPlugins: Record<string, unknown>[];
          browserTools: Record<string, unknown>[];
          serverVersion: string | undefined;
        },
    ),
    mockSendTabSyncAll: vi.fn(() => Promise.resolve()),
    mockStartReadinessPoll: vi.fn(),
    mockGetLastKnownStates: vi.fn(() => new Map<string, string>()),
    mockLoadLastKnownStateFromSession: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('./server-state-cache.js', () => ({
  updateServerStateCache: mockUpdateServerStateCache,
  getServerStateCache: mockGetServerStateCache,
  flushServerStateCacheToSession: vi.fn(),
  setCachesInitialized: vi.fn(),
}));

vi.mock('./confirmation-badge.js', () => ({
  notifyConfirmationRequest: mockNotifyConfirmationRequest,
}));

vi.mock('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: mockForwardToSidePanel,
  sendTabStateNotification: mockSendTabStateNotification,
}));

vi.mock('./tool-dispatch.js', () => ({
  getPluginLink: vi.fn(),
  handleToolDispatch: mockHandleToolDispatch,
  notifyDispatchProgress: vi.fn(),
}));

vi.mock('./plugin-storage.js', () => ({
  storePluginsBatch: vi.fn(() => Promise.resolve()),
  removePlugin: vi.fn(() => Promise.resolve()),
  removePluginsBatch: vi.fn(() => Promise.resolve()),
  getAllPluginMeta: vi.fn(() => Promise.resolve({})),
  getPluginMeta: vi.fn(() => Promise.resolve(null)),
  invalidatePluginCache: vi.fn(),
}));

vi.mock('./iife-injection.js', () => ({
  injectPluginIntoMatchingTabs: vi.fn(() => Promise.resolve([])),
  cleanupAdaptersInMatchingTabs: vi.fn(() => Promise.resolve()),
  isSafePluginName: vi.fn(() => true),
  queryMatchingTabIds: vi.fn(() => Promise.resolve([])),
}));

vi.mock('./tab-state.js', () => ({
  sendTabSyncAll: mockSendTabSyncAll,
  computePluginTabState: vi.fn(() => Promise.resolve({ state: 'closed', tabs: [] })),
  clearTabStateCache: vi.fn(),
  clearPluginTabState: vi.fn(),
  flushLastKnownStateToSession: vi.fn(),
  updateLastKnownState: vi.fn(() => Promise.resolve()),
  getLastKnownStates: mockGetLastKnownStates,
  loadLastKnownStateFromSession: mockLoadLastKnownStateFromSession,
  getAggregateState: vi.fn(() => 'closed'),
  checkTabRemoved: vi.fn(() => Promise.resolve()),
  checkTabChanged: vi.fn(() => Promise.resolve()),
  startReadinessPoll: mockStartReadinessPoll,
}));

vi.mock('./browser-commands/index.js', () => ({
  handleBrowserListTabs: mockHandleBrowserListTabs,
  handleBrowserOpenTab: mockHandleBrowserOpenTab,
  handleBrowserCloseTab: mockHandleBrowserCloseTab,
  handleBrowserNavigateTab: mockHandleBrowserNavigateTab,
  handleBrowserFocusTab: mockHandleBrowserFocusTab,
  handleBrowserGetTabContent: mockHandleBrowserGetTabContent,
  handleBrowserGetPageHtml: mockHandleBrowserGetPageHtml,
  handleBrowserGetStorage: mockHandleBrowserGetStorage,
  handleBrowserGetTabInfo: mockHandleBrowserGetTabInfo,
  handleBrowserListTabGroups: mockHandleBrowserListTabGroups,
  handleBrowserCreateTabGroup: mockHandleBrowserCreateTabGroup,
  handleBrowserAddTabsToGroup: mockHandleBrowserAddTabsToGroup,
  handleBrowserRemoveTabsFromGroup: mockHandleBrowserRemoveTabsFromGroup,
  handleBrowserUpdateTabGroup: mockHandleBrowserUpdateTabGroup,
  handleBrowserListTabsInGroup: mockHandleBrowserListTabsInGroup,
  handleBrowserScreenshotTab: mockHandleBrowserScreenshotTab,
  handleBrowserClickElement: mockHandleBrowserClickElement,
  handleBrowserTypeText: mockHandleBrowserTypeText,
  handleBrowserSelectOption: mockHandleBrowserSelectOption,
  handleBrowserWaitForElement: mockHandleBrowserWaitForElement,
  handleBrowserQueryElements: mockHandleBrowserQueryElements,
  handleBrowserGetCookies: mockHandleBrowserGetCookies,
  handleBrowserSetCookie: mockHandleBrowserSetCookie,
  handleBrowserDeleteCookies: mockHandleBrowserDeleteCookies,
  handleBrowserEnableNetworkCapture: mockHandleBrowserEnableNetworkCapture,
  handleBrowserGetNetworkRequests: mockHandleBrowserGetNetworkRequests,
  handleBrowserGetWebSocketFrames: mockHandleBrowserGetWebSocketFrames,
  handleBrowserDisableNetworkCapture: mockHandleBrowserDisableNetworkCapture,
  handleBrowserGetConsoleLogs: mockHandleBrowserGetConsoleLogs,
  handleBrowserClearConsoleLogs: mockHandleBrowserClearConsoleLogs,
  handleBrowserExecuteScript: mockHandleBrowserExecuteScript,
  handleBrowserListResources: mockHandleBrowserListResources,
  handleBrowserGetResourceContent: mockHandleBrowserGetResourceContent,
  handleBrowserPressKey: mockHandleBrowserPressKey,
  handleBrowserScroll: mockHandleBrowserScroll,
  handleBrowserHoverElement: mockHandleBrowserHoverElement,
  handleBrowserHandleDialog: mockHandleBrowserHandleDialog,
  handleBrowserShowNotification: mockHandleBrowserShowNotification,
  handleBrowserListWindows: mockHandleBrowserListWindows,
  handleBrowserCreateWindow: mockHandleBrowserCreateWindow,
  handleBrowserUpdateWindow: mockHandleBrowserUpdateWindow,
  handleBrowserCloseWindow: mockHandleBrowserCloseWindow,
  handleBrowserDownloadFile: mockHandleBrowserDownloadFile,
  handleBrowserListDownloads: mockHandleBrowserListDownloads,
  handleBrowserGetDownloadStatus: mockHandleBrowserGetDownloadStatus,
  initNotificationClickHandler: vi.fn(),
  handleExtensionCheckAdapter: mockHandleExtensionCheckAdapter,
  handleExtensionForceReconnect: mockHandleExtensionForceReconnect,
  handleExtensionGetState: mockHandleExtensionGetState,
  handleExtensionGetLogs: mockHandleExtensionGetLogs,
  handleExtensionGetSidePanel: mockHandleExtensionGetSidePanel,
}));

// Chrome API stubs for modules that are NOT mocked (plugin-storage, iife-injection,
// tab-state). These real modules call Chrome APIs internally, so stubs prevent
// runtime errors when async handlers fire during routing tests.
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
    session: {
      set: vi.fn(() => Promise.resolve()),
    },
  },
  runtime: {
    reload: vi.fn(),
    sendMessage: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: false }])),
    unregisterContentScripts: vi.fn(() => Promise.resolve()),
    registerContentScripts: vi.fn(() => Promise.resolve()),
  },
  windows: {
    getLastFocused: vi.fn(() => Promise.resolve({ id: 1 })),
  },
};

// Import after mocking so message-router binds to the mocked dependencies
const { validatePluginPayload, handleServerMessage } = await import('./message-router.js');

// ---------------------------------------------------------------------------
// validatePluginPayload tests (pure function — no mocking needed)
// ---------------------------------------------------------------------------

/** Minimal valid plugin payload for use as a base in tests */
const validPayload = (): Record<string, unknown> => ({
  name: 'test-plugin',
  version: '1.0.0',
  urlPatterns: ['*://example.com/*'],
  tools: [
    { name: 'do-thing', displayName: 'Do Thing', description: 'Does a thing', icon: 'wrench', permission: 'auto' },
  ],
});

/** Assert the result is non-null and return the narrowed type */
const expectValid = (raw: unknown): ValidatedPluginPayload => {
  const result = validatePluginPayload(raw);
  expect(result).not.toBeNull();
  return result as ValidatedPluginPayload;
};

describe('validatePluginPayload', () => {
  describe('valid payloads', () => {
    test('accepts a minimal valid payload', () => {
      const result = expectValid(validPayload());
      expect(result.name).toBe('test-plugin');
      expect(result.version).toBe('1.0.0');
      expect(result.urlPatterns).toEqual(['*://example.com/*']);
      expect(result.tools).toHaveLength(1);
    });

    test('accepts payload with optional fields', () => {
      const result = expectValid({
        ...validPayload(),
        displayName: 'Test Plugin',
        sourcePath: '/some/path',
        adapterHash: 'abc123',
        permission: 'auto',
      });
      expect(result.displayName).toBe('Test Plugin');
      expect(result.sourcePath).toBe('/some/path');
      expect(result.adapterHash).toBe('abc123');
      expect(result.permission).toBe('auto');
    });

    test('accepts single-word plugin name', () => {
      expectValid({ ...validPayload(), name: 'slack' });
    });

    test('accepts hyphenated plugin name', () => {
      expectValid({ ...validPayload(), name: 'my-cool-plugin' });
    });

    test('accepts name with digits', () => {
      expectValid({ ...validPayload(), name: 'plugin123' });
    });

    test('accepts name with hyphens and digits', () => {
      expectValid({ ...validPayload(), name: 'my-plugin-2' });
    });
  });

  describe('non-object payloads', () => {
    test('rejects null', () => {
      expect(validatePluginPayload(null)).toBeNull();
    });

    test('rejects undefined', () => {
      expect(validatePluginPayload(undefined)).toBeNull();
    });

    test('rejects a string', () => {
      expect(validatePluginPayload('not-an-object')).toBeNull();
    });

    test('rejects a number', () => {
      expect(validatePluginPayload(42)).toBeNull();
    });

    test('rejects an array', () => {
      expect(validatePluginPayload([1, 2, 3])).toBeNull();
    });

    test('rejects a boolean', () => {
      expect(validatePluginPayload(true)).toBeNull();
    });
  });

  describe('name validation', () => {
    test('rejects missing name', () => {
      const { name: _, ...payload } = validPayload();
      expect(validatePluginPayload(payload)).toBeNull();
    });

    test('rejects empty name', () => {
      expect(validatePluginPayload({ ...validPayload(), name: '' })).toBeNull();
    });

    test('rejects non-string name', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 123 })).toBeNull();
    });

    test('rejects name with uppercase characters', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'MyPlugin' })).toBeNull();
    });

    test('rejects name with forward slash (path traversal)', () => {
      expect(validatePluginPayload({ ...validPayload(), name: '../evil' })).toBeNull();
    });

    test('rejects name with backslash (path traversal)', () => {
      expect(validatePluginPayload({ ...validPayload(), name: '..\\evil' })).toBeNull();
    });

    test('rejects name with dot-dot (path traversal)', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'foo..bar' })).toBeNull();
    });

    test('rejects name with leading hyphen', () => {
      expect(validatePluginPayload({ ...validPayload(), name: '-plugin' })).toBeNull();
    });

    test('rejects name with trailing hyphen', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'plugin-' })).toBeNull();
    });

    test('rejects name with consecutive hyphens', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'my--plugin' })).toBeNull();
    });

    test('rejects name with spaces', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'my plugin' })).toBeNull();
    });

    test('rejects name with special characters', () => {
      expect(validatePluginPayload({ ...validPayload(), name: 'my_plugin' })).toBeNull();
    });

    test('rejects name with @ symbol', () => {
      expect(validatePluginPayload({ ...validPayload(), name: '@scoped/plugin' })).toBeNull();
    });
  });

  describe('urlPatterns handling', () => {
    test('passes through valid string patterns', () => {
      const result = expectValid({
        ...validPayload(),
        urlPatterns: ['*://a.com/*', '*://b.com/*'],
      });
      expect(result.urlPatterns).toEqual(['*://a.com/*', '*://b.com/*']);
    });

    test('returns empty array when urlPatterns is missing', () => {
      const { urlPatterns: _, ...payload } = validPayload();
      const result = expectValid(payload);
      expect(result.urlPatterns).toEqual([]);
    });

    test('returns empty array when urlPatterns is not an array', () => {
      const result = expectValid({ ...validPayload(), urlPatterns: 'not-an-array' });
      expect(result.urlPatterns).toEqual([]);
    });

    test('filters out non-string entries from urlPatterns', () => {
      const result = expectValid({
        ...validPayload(),
        urlPatterns: ['*://valid.com/*', 123, null, '*://also-valid.com/*'],
      });
      expect(result.urlPatterns).toEqual(['*://valid.com/*', '*://also-valid.com/*']);
    });
  });

  describe('tools handling', () => {
    test('passes through valid tool definitions', () => {
      const tools = [
        { name: 'tool-a', displayName: 'Tool A', description: 'Tool A', icon: 'wrench', permission: 'auto' },
        { name: 'tool-b', displayName: 'Tool B', description: 'Tool B', icon: 'wrench', permission: 'off' },
      ];
      const result = expectValid({ ...validPayload(), tools });
      expect(result.tools).toHaveLength(2);
      const firstTool = result.tools[0];
      expect(firstTool).toBeDefined();
      expect((firstTool as NonNullable<typeof firstTool>).name).toBe('tool-a');
      const secondTool = result.tools[1];
      expect(secondTool).toBeDefined();
      expect((secondTool as NonNullable<typeof secondTool>).permission).toBe('off');
    });

    test('returns empty array when tools is missing', () => {
      const { tools: _, ...payload } = validPayload();
      const result = expectValid(payload);
      expect(result.tools).toEqual([]);
    });

    test('returns empty array when tools is not an array', () => {
      const result = expectValid({ ...validPayload(), tools: 'not-an-array' });
      expect(result.tools).toEqual([]);
    });

    test('filters out tools missing name', () => {
      const result = expectValid({
        ...validPayload(),
        tools: [
          { description: 'No name', icon: 'wrench', permission: 'auto' },
          { name: 'valid', displayName: 'Valid', description: 'Has name', icon: 'wrench', permission: 'auto' },
        ],
      });
      expect(result.tools).toHaveLength(1);
      const filteredTool = result.tools[0];
      expect(filteredTool).toBeDefined();
      expect((filteredTool as NonNullable<typeof filteredTool>).name).toBe('valid');
    });

    test('filters out tools missing description', () => {
      const result = expectValid({
        ...validPayload(),
        tools: [
          { name: 'no-desc', displayName: 'No Desc', icon: 'wrench', permission: 'auto' },
          { name: 'valid', displayName: 'Valid', description: 'Has desc', icon: 'wrench', permission: 'auto' },
        ],
      });
      expect(result.tools).toHaveLength(1);
    });

    test('defaults permission to off for tools missing the permission field and logs a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = expectValid({
        ...validPayload(),
        tools: [
          { name: 'no-permission', displayName: 'No Permission', description: 'Missing permission', icon: 'wrench' },
          { name: 'valid', displayName: 'Valid', description: 'Has permission', icon: 'wrench', permission: 'off' },
        ],
      });
      expect(result.tools).toHaveLength(2);
      const noPermissionTool = result.tools[0];
      expect(noPermissionTool).toBeDefined();
      expect((noPermissionTool as NonNullable<typeof noPermissionTool>).name).toBe('no-permission');
      expect((noPermissionTool as NonNullable<typeof noPermissionTool>).permission).toBe('off');
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toContain('no-permission');
      warnSpy.mockRestore();
    });

    test('filters out non-object tool entries', () => {
      const result = expectValid({
        ...validPayload(),
        tools: [
          'not-an-object',
          null,
          42,
          { name: 'valid', displayName: 'Valid', description: 'OK', icon: 'wrench', permission: 'auto' },
        ],
      });
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('default values', () => {
    test('defaults version to 0.0.0 when missing', () => {
      const { version: _, ...payload } = validPayload();
      const result = expectValid(payload);
      expect(result.version).toBe('0.0.0');
    });

    test('defaults version to 0.0.0 when non-string', () => {
      const result = expectValid({ ...validPayload(), version: 123 });
      expect(result.version).toBe('0.0.0');
    });

    test('defaults permission to off when missing', () => {
      const { permission: _, ...payload } = validPayload();
      const result = expectValid(payload);
      expect(result.permission).toBe('off');
    });

    test('defaults permission to off for invalid value', () => {
      const result = expectValid({ ...validPayload(), permission: 'invalid' });
      expect(result.permission).toBe('off');
    });

    test('accepts auto permission', () => {
      expect(expectValid({ ...validPayload(), permission: 'auto' }).permission).toBe('auto');
    });

    test('accepts ask permission', () => {
      expect(expectValid({ ...validPayload(), permission: 'ask' }).permission).toBe('ask');
    });

    test('accepts off permission', () => {
      expect(expectValid({ ...validPayload(), permission: 'off' }).permission).toBe('off');
    });

    test('displayName falls back to name when missing', () => {
      expect(expectValid(validPayload()).displayName).toBe('test-plugin');
    });

    test('displayName falls back to name when non-string', () => {
      expect(expectValid({ ...validPayload(), displayName: 42 }).displayName).toBe('test-plugin');
    });

    test('sourcePath is undefined when missing', () => {
      expect(expectValid(validPayload()).sourcePath).toBeUndefined();
    });

    test('adapterHash is undefined when missing', () => {
      expect(expectValid(validPayload()).adapterHash).toBeUndefined();
    });
  });

  describe('SVG icon fields', () => {
    test('extracts iconSvg and iconInactiveSvg when present', () => {
      const result = expectValid({
        ...validPayload(),
        iconSvg: '<svg>active</svg>',
        iconInactiveSvg: '<svg>inactive</svg>',
      });
      expect(result.iconSvg).toBe('<svg>active</svg>');
      expect(result.iconInactiveSvg).toBe('<svg>inactive</svg>');
    });

    test('iconSvg is undefined when missing', () => {
      expect(expectValid(validPayload()).iconSvg).toBeUndefined();
    });

    test('iconInactiveSvg is undefined when missing', () => {
      expect(expectValid(validPayload()).iconInactiveSvg).toBeUndefined();
    });

    test('iconSvg is undefined when non-string', () => {
      expect(expectValid({ ...validPayload(), iconSvg: 42 }).iconSvg).toBeUndefined();
    });

    test('iconInactiveSvg is undefined when non-string', () => {
      expect(expectValid({ ...validPayload(), iconInactiveSvg: true }).iconInactiveSvg).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// handleServerMessage tests — routing and side panel forwarding
// ---------------------------------------------------------------------------

/** Reset routing-related mocks between tests */
const resetRoutingMocks = (): void => {
  mockSendToServer.mockReset();
  mockForwardToSidePanel.mockReset();
  mockHandleToolDispatch.mockReset();
  mockHandleBrowserListTabs.mockReset();
  mockHandleBrowserOpenTab.mockReset();
  mockHandleBrowserCloseTab.mockReset();
  mockHandleBrowserNavigateTab.mockReset();
  mockHandleBrowserGetTabContent.mockReset();
  mockHandleBrowserGetPageHtml.mockReset();
  mockHandleBrowserGetStorage.mockReset();
  mockHandleBrowserScreenshotTab.mockReset();
  mockHandleBrowserClickElement.mockReset();
  mockHandleBrowserTypeText.mockReset();
  mockHandleBrowserSelectOption.mockReset();
  mockHandleBrowserWaitForElement.mockReset();
  mockHandleBrowserQueryElements.mockReset();
  mockHandleBrowserGetCookies.mockReset();
  mockHandleBrowserSetCookie.mockReset();
  mockHandleBrowserDeleteCookies.mockReset();
  mockHandleBrowserEnableNetworkCapture.mockReset();
  mockHandleBrowserGetNetworkRequests.mockReset();
  mockHandleBrowserGetWebSocketFrames.mockReset();
  mockHandleBrowserDisableNetworkCapture.mockReset();
  mockHandleBrowserGetConsoleLogs.mockReset();
  mockHandleBrowserClearConsoleLogs.mockReset();
  mockHandleBrowserExecuteScript.mockReset();
  mockHandleBrowserListResources.mockReset();
  mockHandleBrowserGetResourceContent.mockReset();
  mockHandleBrowserScroll.mockReset();
  mockHandleBrowserHoverElement.mockReset();
  mockHandleBrowserHandleDialog.mockReset();
  mockHandleExtensionGetState.mockReset();
  mockHandleExtensionGetLogs.mockReset();
  mockHandleExtensionGetSidePanel.mockReset();
  mockHandleExtensionCheckAdapter.mockReset();
  mockHandleExtensionForceReconnect.mockReset();
  mockUpdateServerStateCache.mockReset();
  mockGetServerStateCache.mockReset();
  mockGetServerStateCache.mockReturnValue({
    plugins: [],
    failedPlugins: [],
    browserTools: [],
    serverVersion: undefined,
  });
  mockGetLastKnownStates.mockReset();
  mockGetLastKnownStates.mockReturnValue(new Map());
  mockLoadLastKnownStateFromSession.mockReset();
};

describe('handleServerMessage', () => {
  beforeEach(() => {
    resetRoutingMocks();
    // Default mock implementations so async handlers don't throw
    mockHandleToolDispatch.mockResolvedValue(undefined);
    mockHandleBrowserListTabs.mockResolvedValue(undefined);
    mockHandleBrowserOpenTab.mockResolvedValue(undefined);
    mockHandleBrowserCloseTab.mockResolvedValue(undefined);
    mockHandleBrowserNavigateTab.mockResolvedValue(undefined);
    mockHandleBrowserGetTabContent.mockResolvedValue(undefined);
    mockHandleBrowserGetPageHtml.mockResolvedValue(undefined);
    mockHandleBrowserGetStorage.mockResolvedValue(undefined);
    mockHandleBrowserScreenshotTab.mockResolvedValue(undefined);
    mockHandleBrowserClickElement.mockResolvedValue(undefined);
    mockHandleBrowserTypeText.mockResolvedValue(undefined);
    mockHandleBrowserSelectOption.mockResolvedValue(undefined);
    mockHandleBrowserWaitForElement.mockResolvedValue(undefined);
    mockHandleBrowserQueryElements.mockResolvedValue(undefined);
    mockHandleBrowserGetCookies.mockResolvedValue(undefined);
    mockHandleBrowserSetCookie.mockResolvedValue(undefined);
    mockHandleBrowserDeleteCookies.mockResolvedValue(undefined);
    mockHandleBrowserEnableNetworkCapture.mockResolvedValue(undefined);
    mockHandleBrowserExecuteScript.mockResolvedValue(undefined);
    mockHandleBrowserListResources.mockResolvedValue(undefined);
    mockHandleBrowserGetResourceContent.mockResolvedValue(undefined);
    mockHandleBrowserScroll.mockResolvedValue(undefined);
    mockHandleBrowserHoverElement.mockResolvedValue(undefined);
    mockHandleBrowserHandleDialog.mockResolvedValue(undefined);
    mockHandleExtensionGetState.mockResolvedValue(undefined);
    mockHandleExtensionGetLogs.mockResolvedValue(undefined);
    mockHandleExtensionGetSidePanel.mockResolvedValue(undefined);
    mockHandleExtensionCheckAdapter.mockResolvedValue(undefined);
    mockHandleExtensionForceReconnect.mockResolvedValue(undefined);
    mockLoadLastKnownStateFromSession.mockResolvedValue(undefined);
  });

  describe('sync.full routing', () => {
    test('dispatches sync.full to the internal handler without error', () => {
      // sync.full triggers handleSyncFull which calls plugin-storage and
      // iife-injection internally. The handler runs asynchronously via
      // .catch(err => console.warn(...)), so we verify it doesn't produce a -32601 error.
      handleServerMessage({
        method: 'sync.full',
        params: {
          plugins: [
            {
              name: 'test-plugin',
              version: '1.0.0',
              urlPatterns: ['*://example.com/*'],
              tools: [
                {
                  name: 'do-thing',
                  displayName: 'Do Thing',
                  description: 'Does a thing',
                  icon: 'wrench',
                  permission: 'auto',
                },
              ],
            },
          ],
        },
      });

      // No -32601 error should be sent (method is recognized)
      expect(mockSendToServer).not.toHaveBeenCalled();
    });

    test('does not forward sync.full to side panel', () => {
      handleServerMessage({
        method: 'sync.full',
        params: { plugins: [] },
      });

      // sync.full is NOT in SIDE_PANEL_METHODS
      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('handleSyncFull populates server state cache with enriched payload', async () => {
      handleServerMessage({
        method: 'sync.full',
        params: {
          plugins: [
            {
              name: 'test-plugin',
              version: '1.0.0',
              urlPatterns: ['*://example.com/*'],
              source: 'npm',
              sdkVersion: '0.5.0',
              update: { latestVersion: '2.0.0', updateCommand: 'npm install -g ...' },
              tools: [
                {
                  name: 'do-thing',
                  displayName: 'Do Thing',
                  description: 'Does a thing',
                  icon: 'wrench',
                  permission: 'auto',
                },
              ],
            },
          ],
          failedPlugins: [{ specifier: 'bad-plugin', error: 'failed' }],
          browserTools: [{ name: 'browser_list_tabs', description: 'List tabs', permission: 'auto' }],
          serverVersion: '3.0.0',
        },
      });

      // handleSyncFull is async — flush microtasks
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(1);
      const cacheArg = mockUpdateServerStateCache.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(cacheArg).toBeDefined();

      // Verify plugins include enriched fields
      const plugins = cacheArg.plugins as { name: string; source: string; sdkVersion?: string; update?: unknown }[];
      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.source).toBe('npm');
      expect(plugins[0]?.sdkVersion).toBe('0.5.0');
      expect(plugins[0]?.update).toEqual({ latestVersion: '2.0.0', updateCommand: 'npm install -g ...' });

      // Verify server-owned top-level fields
      expect(cacheArg.failedPlugins).toEqual([{ specifier: 'bad-plugin', error: 'failed' }]);
      expect(cacheArg.browserTools).toEqual([
        { name: 'browser_list_tabs', description: 'List tabs', permission: 'auto' },
      ]);
      expect(cacheArg.serverVersion).toBe('3.0.0');
    });

    test('handleSyncFull sends plugins.changed before sendTabSyncAll', async () => {
      const callOrder: string[] = [];

      mockForwardToSidePanel.mockImplementation(() => {
        callOrder.push('forwardToSidePanel');
      });
      mockSendTabSyncAll.mockImplementation(() => {
        callOrder.push('sendTabSyncAll');
        return Promise.resolve();
      });
      mockStartReadinessPoll.mockImplementation(() => {
        callOrder.push('startReadinessPoll');
      });

      handleServerMessage({
        method: 'sync.full',
        params: {
          plugins: [
            {
              name: 'test-plugin',
              version: '1.0.0',
              urlPatterns: ['*://example.com/*'],
              tools: [
                {
                  name: 'do-thing',
                  displayName: 'Do Thing',
                  description: 'Does a thing',
                  icon: 'wrench',
                  permission: 'auto',
                },
              ],
            },
          ],
        },
      });

      // handleSyncFull is async — flush microtasks so sendTabSyncAll and
      // startReadinessPoll fire (sendTabSyncAll is fire-and-forget with .then)
      await new Promise(resolve => setTimeout(resolve, 0));

      // forwardToSidePanel (plugins.changed) must be called BEFORE sendTabSyncAll
      expect(callOrder.indexOf('forwardToSidePanel')).toBeLessThan(callOrder.indexOf('sendTabSyncAll'));

      // startReadinessPoll is chained via .then() on sendTabSyncAll
      expect(callOrder.indexOf('sendTabSyncAll')).toBeLessThan(callOrder.indexOf('startReadinessPoll'));
    });
  });

  describe('plugin.update routing', () => {
    test('dispatches plugin.update to the internal handler without error', () => {
      handleServerMessage({
        method: 'plugin.update',
        params: {
          name: 'test-plugin',
          version: '2.0.0',
          urlPatterns: ['*://example.com/*'],
          tools: [
            {
              name: 'do-thing',
              displayName: 'Do Thing',
              description: 'Does a thing',
              icon: 'wrench',
              permission: 'auto',
            },
          ],
        },
      });

      expect(mockSendToServer).not.toHaveBeenCalled();
    });

    test('does not forward plugin.update to side panel', () => {
      handleServerMessage({
        method: 'plugin.update',
        params: {
          name: 'test-plugin',
          version: '1.0.0',
          urlPatterns: [],
          tools: [],
        },
      });

      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('handlePluginUpdate updates server state cache with plugin data', async () => {
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          {
            name: 'existing-plugin',
            displayName: 'Existing',
            version: '1.0.0',
            permission: 'off',
            source: 'local',
            tabState: 'closed',
            urlPatterns: [],
            tools: [],
          },
        ],
        failedPlugins: [],
        browserTools: [],
        serverVersion: '1.0.0',
      });

      handleServerMessage({
        method: 'plugin.update',
        params: {
          name: 'test-plugin',
          version: '2.0.0',
          urlPatterns: ['*://example.com/*'],
          source: 'npm',
          sdkVersion: '0.5.0',
          tools: [
            {
              name: 'do-thing',
              displayName: 'Do Thing',
              description: 'Does a thing',
              icon: 'wrench',
              permission: 'auto',
            },
          ],
        },
      });

      // handlePluginUpdate is async — flush microtasks
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(1);
      const cacheArg = mockUpdateServerStateCache.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(cacheArg).toBeDefined();

      // Verify the updated plugin list contains both existing and new plugin
      const plugins = cacheArg.plugins as { name: string; source: string }[];
      expect(plugins).toHaveLength(2);
      const names = plugins.map(p => p.name).sort();
      expect(names).toEqual(['existing-plugin', 'test-plugin']);

      // Verify the updated plugin has enriched fields
      const updatedPlugin = plugins.find(p => p.name === 'test-plugin');
      expect(updatedPlugin).toBeDefined();
      expect(updatedPlugin?.source).toBe('npm');
    });
  });

  describe('plugin.uninstall routing', () => {
    test('dispatches plugin.uninstall with id to the internal handler', () => {
      handleServerMessage({
        method: 'plugin.uninstall',
        id: 42,
        params: { name: 'test-plugin' },
      });

      // No -32601 error (method is recognized)
      expect(mockSendToServer).not.toHaveBeenCalled();
    });

    test('silently ignores plugin.uninstall without an id (wrapAsync guard)', () => {
      handleServerMessage({
        method: 'plugin.uninstall',
        params: { name: 'test-plugin' },
      });

      // The server always sends plugin.uninstall as a request (with id), but
      // the wrapAsync guard still protects against malformed messages.
      expect(mockSendToServer).not.toHaveBeenCalled();
    });

    test('removes uninstalled plugin from server state cache and forwards plugins.changed', async () => {
      mockGetServerStateCache.mockReturnValue({
        plugins: [
          { name: 'test-plugin', displayName: 'Test', version: '1.0.0' },
          { name: 'other-plugin', displayName: 'Other', version: '2.0.0' },
        ],
        failedPlugins: [],
        browserTools: [],
        serverVersion: undefined,
      });

      handleServerMessage({
        method: 'plugin.uninstall',
        id: 99,
        params: { name: 'test-plugin' },
      });

      // handlePluginUninstall is async — flush microtasks
      await new Promise(resolve => setTimeout(resolve, 0));

      // Cache must be updated to exclude the uninstalled plugin
      expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(1);
      const cacheArg = mockUpdateServerStateCache.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(cacheArg).toBeDefined();
      const plugins = cacheArg.plugins as { name: string }[];
      expect(plugins).toHaveLength(1);
      expect(plugins).toMatchObject([{ name: 'other-plugin' }]);

      // plugins.changed must be forwarded to the side panel
      const forwardCalls = mockForwardToSidePanel.mock.calls;
      const pluginsChangedCall = forwardCalls.find(call => {
        const msg = call[0] as { type: string; data: { method: string } };
        return msg.data.method === 'plugins.changed';
      });
      expect(pluginsChangedCall).toBeDefined();
    });
  });

  describe('tool.dispatch routing', () => {
    test('delegates to handleToolDispatch with params and id', () => {
      handleServerMessage({
        method: 'tool.dispatch',
        id: 10,
        params: { plugin: 'slack', tool: 'send-message', input: {} },
      });

      expect(mockHandleToolDispatch).toHaveBeenCalledTimes(1);
      expect(mockHandleToolDispatch).toHaveBeenCalledWith({ plugin: 'slack', tool: 'send-message', input: {} }, 10);
    });

    test('does not dispatch tool.dispatch without an id', () => {
      handleServerMessage({
        method: 'tool.dispatch',
        params: { plugin: 'slack', tool: 'send-message', input: {} },
      });

      expect(mockHandleToolDispatch).not.toHaveBeenCalled();
    });
  });

  describe('browser command routing', () => {
    test('dispatches browser.listTabs to handleBrowserListTabs', () => {
      handleServerMessage({ method: 'browser.listTabs', id: 20 });

      expect(mockHandleBrowserListTabs).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserListTabs).toHaveBeenCalledWith(20);
    });

    test('dispatches browser.openTab to handleBrowserOpenTab', () => {
      handleServerMessage({
        method: 'browser.openTab',
        id: 21,
        params: { url: 'https://example.com' },
      });

      expect(mockHandleBrowserOpenTab).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserOpenTab).toHaveBeenCalledWith({ url: 'https://example.com' }, 21);
    });

    test('dispatches browser.closeTab to handleBrowserCloseTab', () => {
      handleServerMessage({
        method: 'browser.closeTab',
        id: 22,
        params: { tabId: 5 },
      });

      expect(mockHandleBrowserCloseTab).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserCloseTab).toHaveBeenCalledWith({ tabId: 5 }, 22);
    });

    test('dispatches browser.navigateTab to handleBrowserNavigateTab', () => {
      handleServerMessage({
        method: 'browser.navigateTab',
        id: 23,
        params: { tabId: 3, url: 'https://example.com/new' },
      });

      expect(mockHandleBrowserNavigateTab).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserNavigateTab).toHaveBeenCalledWith({ tabId: 3, url: 'https://example.com/new' }, 23);
    });

    test('dispatches browser.focusTab to handleBrowserFocusTab', () => {
      handleServerMessage({
        method: 'browser.focusTab',
        id: 25,
        params: { tabId: 10 },
      });

      expect(mockHandleBrowserFocusTab).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserFocusTab).toHaveBeenCalledWith({ tabId: 10 }, 25);
    });

    test('dispatches browser.getTabInfo to handleBrowserGetTabInfo', () => {
      handleServerMessage({
        method: 'browser.getTabInfo',
        id: 26,
        params: { tabId: 11 },
      });

      expect(mockHandleBrowserGetTabInfo).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetTabInfo).toHaveBeenCalledWith({ tabId: 11 }, 26);
    });

    test('dispatches browser.listTabGroups to handleBrowserListTabGroups', () => {
      handleServerMessage({
        method: 'browser.listTabGroups',
        id: 50,
        params: {},
      });

      expect(mockHandleBrowserListTabGroups).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserListTabGroups).toHaveBeenCalledWith({}, 50);
    });

    test('dispatches browser.createTabGroup to handleBrowserCreateTabGroup', () => {
      handleServerMessage({
        method: 'browser.createTabGroup',
        id: 51,
        params: { tabIds: [1, 2], title: 'Test' },
      });

      expect(mockHandleBrowserCreateTabGroup).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserCreateTabGroup).toHaveBeenCalledWith({ tabIds: [1, 2], title: 'Test' }, 51);
    });

    test('dispatches browser.addTabsToGroup to handleBrowserAddTabsToGroup', () => {
      handleServerMessage({
        method: 'browser.addTabsToGroup',
        id: 52,
        params: { groupId: 5, tabIds: [10] },
      });

      expect(mockHandleBrowserAddTabsToGroup).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserAddTabsToGroup).toHaveBeenCalledWith({ groupId: 5, tabIds: [10] }, 52);
    });

    test('dispatches browser.removeTabsFromGroup to handleBrowserRemoveTabsFromGroup', () => {
      handleServerMessage({
        method: 'browser.removeTabsFromGroup',
        id: 53,
        params: { tabIds: [10, 20] },
      });

      expect(mockHandleBrowserRemoveTabsFromGroup).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserRemoveTabsFromGroup).toHaveBeenCalledWith({ tabIds: [10, 20] }, 53);
    });

    test('dispatches browser.updateTabGroup to handleBrowserUpdateTabGroup', () => {
      handleServerMessage({
        method: 'browser.updateTabGroup',
        id: 54,
        params: { groupId: 3, title: 'Updated' },
      });

      expect(mockHandleBrowserUpdateTabGroup).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserUpdateTabGroup).toHaveBeenCalledWith({ groupId: 3, title: 'Updated' }, 54);
    });

    test('dispatches browser.listTabsInGroup to handleBrowserListTabsInGroup', () => {
      handleServerMessage({
        method: 'browser.listTabsInGroup',
        id: 55,
        params: { groupId: 5 },
      });

      expect(mockHandleBrowserListTabsInGroup).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserListTabsInGroup).toHaveBeenCalledWith({ groupId: 5 }, 55);
    });

    test('dispatches browser.getTabContent to handleBrowserGetTabContent', () => {
      handleServerMessage({
        method: 'browser.getTabContent',
        id: 28,
        params: { tabId: 13, selector: 'body', maxLength: 50000 },
      });

      expect(mockHandleBrowserGetTabContent).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetTabContent).toHaveBeenCalledWith(
        { tabId: 13, selector: 'body', maxLength: 50000 },
        28,
      );
    });

    test('dispatches browser.getPageHtml to handleBrowserGetPageHtml', () => {
      handleServerMessage({
        method: 'browser.getPageHtml',
        id: 29,
        params: { tabId: 14, selector: 'html', maxLength: 200000 },
      });

      expect(mockHandleBrowserGetPageHtml).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetPageHtml).toHaveBeenCalledWith({ tabId: 14, selector: 'html', maxLength: 200000 }, 29);
    });

    test('dispatches browser.getStorage to handleBrowserGetStorage', () => {
      handleServerMessage({
        method: 'browser.getStorage',
        id: 50,
        params: { tabId: 25, storageType: 'local' },
      });

      expect(mockHandleBrowserGetStorage).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetStorage).toHaveBeenCalledWith({ tabId: 25, storageType: 'local' }, 50);
    });

    test('dispatches browser.screenshotTab to handleBrowserScreenshotTab', () => {
      handleServerMessage({
        method: 'browser.screenshotTab',
        id: 27,
        params: { tabId: 12 },
      });

      expect(mockHandleBrowserScreenshotTab).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserScreenshotTab).toHaveBeenCalledWith({ tabId: 12 }, 27);
    });

    test('dispatches browser.clickElement to handleBrowserClickElement', () => {
      handleServerMessage({
        method: 'browser.clickElement',
        id: 30,
        params: { tabId: 15, selector: '#btn' },
      });

      expect(mockHandleBrowserClickElement).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserClickElement).toHaveBeenCalledWith({ tabId: 15, selector: '#btn' }, 30);
    });

    test('dispatches browser.typeText to handleBrowserTypeText', () => {
      handleServerMessage({
        method: 'browser.typeText',
        id: 31,
        params: { tabId: 16, selector: '#input', text: 'hello', clear: true },
      });

      expect(mockHandleBrowserTypeText).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserTypeText).toHaveBeenCalledWith(
        { tabId: 16, selector: '#input', text: 'hello', clear: true },
        31,
      );
    });

    test('dispatches browser.selectOption to handleBrowserSelectOption', () => {
      handleServerMessage({
        method: 'browser.selectOption',
        id: 32,
        params: { tabId: 17, selector: '#sel', value: 'b' },
      });

      expect(mockHandleBrowserSelectOption).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserSelectOption).toHaveBeenCalledWith({ tabId: 17, selector: '#sel', value: 'b' }, 32);
    });

    test('dispatches browser.waitForElement to handleBrowserWaitForElement', () => {
      handleServerMessage({
        method: 'browser.waitForElement',
        id: 33,
        params: { tabId: 18, selector: '#delayed', timeout: 5000, visible: true },
      });

      expect(mockHandleBrowserWaitForElement).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserWaitForElement).toHaveBeenCalledWith(
        { tabId: 18, selector: '#delayed', timeout: 5000, visible: true },
        33,
      );
    });

    test('dispatches browser.queryElements to handleBrowserQueryElements', () => {
      handleServerMessage({
        method: 'browser.queryElements',
        id: 34,
        params: { tabId: 19, selector: 'input', limit: 50 },
      });

      expect(mockHandleBrowserQueryElements).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserQueryElements).toHaveBeenCalledWith({ tabId: 19, selector: 'input', limit: 50 }, 34);
    });

    test('dispatches browser.getCookies to handleBrowserGetCookies', () => {
      handleServerMessage({
        method: 'browser.getCookies',
        id: 35,
        params: { url: 'https://example.com', name: 'session' },
      });

      expect(mockHandleBrowserGetCookies).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetCookies).toHaveBeenCalledWith({ url: 'https://example.com', name: 'session' }, 35);
    });

    test('dispatches browser.setCookie to handleBrowserSetCookie', () => {
      handleServerMessage({
        method: 'browser.setCookie',
        id: 36,
        params: { url: 'https://example.com', name: 'token', value: 'abc123' },
      });

      expect(mockHandleBrowserSetCookie).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserSetCookie).toHaveBeenCalledWith(
        { url: 'https://example.com', name: 'token', value: 'abc123' },
        36,
      );
    });

    test('dispatches browser.deleteCookies to handleBrowserDeleteCookies', () => {
      handleServerMessage({
        method: 'browser.deleteCookies',
        id: 37,
        params: { url: 'https://example.com', name: 'token' },
      });

      expect(mockHandleBrowserDeleteCookies).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserDeleteCookies).toHaveBeenCalledWith({ url: 'https://example.com', name: 'token' }, 37);
    });

    test('dispatches browser.enableNetworkCapture to handleBrowserEnableNetworkCapture', () => {
      handleServerMessage({
        method: 'browser.enableNetworkCapture',
        id: 38,
        params: { tabId: 20, maxRequests: 200, urlFilter: '/api' },
      });

      expect(mockHandleBrowserEnableNetworkCapture).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserEnableNetworkCapture).toHaveBeenCalledWith(
        { tabId: 20, maxRequests: 200, urlFilter: '/api' },
        38,
      );
    });

    test('dispatches browser.getNetworkRequests to handleBrowserGetNetworkRequests', () => {
      handleServerMessage({
        method: 'browser.getNetworkRequests',
        id: 39,
        params: { tabId: 21, clear: true },
      });

      expect(mockHandleBrowserGetNetworkRequests).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetNetworkRequests).toHaveBeenCalledWith({ tabId: 21, clear: true }, 39);
    });

    test('dispatches browser.disableNetworkCapture to handleBrowserDisableNetworkCapture', () => {
      handleServerMessage({
        method: 'browser.disableNetworkCapture',
        id: 40,
        params: { tabId: 22 },
      });

      expect(mockHandleBrowserDisableNetworkCapture).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserDisableNetworkCapture).toHaveBeenCalledWith({ tabId: 22 }, 40);
    });

    test('dispatches browser.getConsoleLogs to handleBrowserGetConsoleLogs', () => {
      handleServerMessage({
        method: 'browser.getConsoleLogs',
        id: 41,
        params: { tabId: 23, clear: false, level: 'error' },
      });

      expect(mockHandleBrowserGetConsoleLogs).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetConsoleLogs).toHaveBeenCalledWith({ tabId: 23, clear: false, level: 'error' }, 41);
    });

    test('dispatches browser.clearConsoleLogs to handleBrowserClearConsoleLogs', () => {
      handleServerMessage({
        method: 'browser.clearConsoleLogs',
        id: 42,
        params: { tabId: 24 },
      });

      expect(mockHandleBrowserClearConsoleLogs).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserClearConsoleLogs).toHaveBeenCalledWith({ tabId: 24 }, 42);
    });

    test('dispatches browser.executeScript to handleBrowserExecuteScript', () => {
      handleServerMessage({
        method: 'browser.executeScript',
        id: 24,
        params: { tabId: 7, code: 'return 1' },
      });

      expect(mockHandleBrowserExecuteScript).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserExecuteScript).toHaveBeenCalledWith({ tabId: 7, code: 'return 1' }, 24);
    });

    test('dispatches browser.listResources to handleBrowserListResources', () => {
      handleServerMessage({
        method: 'browser.listResources',
        id: 43,
        params: { tabId: 25, type: 'Script' },
      });

      expect(mockHandleBrowserListResources).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserListResources).toHaveBeenCalledWith({ tabId: 25, type: 'Script' }, 43);
    });

    test('dispatches browser.getResourceContent to handleBrowserGetResourceContent', () => {
      handleServerMessage({
        method: 'browser.getResourceContent',
        id: 44,
        params: { tabId: 26, url: 'https://example.com/app.js', maxLength: 100000 },
      });

      expect(mockHandleBrowserGetResourceContent).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserGetResourceContent).toHaveBeenCalledWith(
        { tabId: 26, url: 'https://example.com/app.js', maxLength: 100000 },
        44,
      );
    });

    test('dispatches browser.pressKey to handleBrowserPressKey', () => {
      handleServerMessage({
        method: 'browser.pressKey',
        id: 45,
        params: { tabId: 10, key: 'Enter' },
      });

      expect(mockHandleBrowserPressKey).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserPressKey).toHaveBeenCalledWith({ tabId: 10, key: 'Enter' }, 45);
    });

    test('dispatches browser.scroll to handleBrowserScroll', () => {
      handleServerMessage({
        method: 'browser.scroll',
        id: 46,
        params: { tabId: 10, direction: 'down' },
      });

      expect(mockHandleBrowserScroll).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserScroll).toHaveBeenCalledWith({ tabId: 10, direction: 'down' }, 46);
    });

    test('dispatches browser.hoverElement to handleBrowserHoverElement', () => {
      handleServerMessage({
        method: 'browser.hoverElement',
        id: 47,
        params: { tabId: 10, selector: '#hover-target' },
      });

      expect(mockHandleBrowserHoverElement).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserHoverElement).toHaveBeenCalledWith({ tabId: 10, selector: '#hover-target' }, 47);
    });

    test('dispatches browser.handleDialog to handleBrowserHandleDialog', () => {
      handleServerMessage({
        method: 'browser.handleDialog',
        id: 48,
        params: { tabId: 10, action: 'accept' },
      });

      expect(mockHandleBrowserHandleDialog).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserHandleDialog).toHaveBeenCalledWith({ tabId: 10, action: 'accept' }, 48);
    });

    test('dispatches extension.getState to handleExtensionGetState', () => {
      handleServerMessage({ method: 'extension.getState', id: 49 });

      expect(mockHandleExtensionGetState).toHaveBeenCalledTimes(1);
      expect(mockHandleExtensionGetState).toHaveBeenCalledWith(49);
    });

    test('dispatches extension.getLogs to handleExtensionGetLogs', () => {
      handleServerMessage({ method: 'extension.getLogs', id: 50, params: { level: 'error' } });

      expect(mockHandleExtensionGetLogs).toHaveBeenCalledTimes(1);
      expect(mockHandleExtensionGetLogs).toHaveBeenCalledWith({ level: 'error' }, 50);
    });

    test('dispatches extension.getSidePanel to handleExtensionGetSidePanel', () => {
      handleServerMessage({ method: 'extension.getSidePanel', id: 51 });

      expect(mockHandleExtensionGetSidePanel).toHaveBeenCalledTimes(1);
      expect(mockHandleExtensionGetSidePanel).toHaveBeenCalledWith(51);
    });

    test('dispatches extension.checkAdapter to handleExtensionCheckAdapter', () => {
      handleServerMessage({ method: 'extension.checkAdapter', id: 52, params: { plugin: 'slack' } });

      expect(mockHandleExtensionCheckAdapter).toHaveBeenCalledTimes(1);
      expect(mockHandleExtensionCheckAdapter).toHaveBeenCalledWith({ plugin: 'slack' }, 52);
    });

    test('dispatches extension.forceReconnect to handleExtensionForceReconnect', () => {
      handleServerMessage({ method: 'extension.forceReconnect', id: 53 });

      expect(mockHandleExtensionForceReconnect).toHaveBeenCalledTimes(1);
      expect(mockHandleExtensionForceReconnect).toHaveBeenCalledWith(53);
    });

    test('extension.getTabState returns last-known tab states via sendToServer', () => {
      const states = new Map<string, string>([
        [
          'slack',
          JSON.stringify({
            state: 'ready',
            tabs: [{ tabId: 1, url: 'https://slack.com', title: 'Slack', ready: true }],
          }),
        ],
        ['github', JSON.stringify({ state: 'closed', tabs: [] })],
      ]);
      mockGetLastKnownStates.mockReturnValueOnce(states);

      handleServerMessage({ method: 'extension.getTabState', id: 54 });

      expect(mockSendToServer).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: {
          tabStates: {
            slack: { state: 'ready', tabs: [{ tabId: 1, url: 'https://slack.com', title: 'Slack', ready: true }] },
            github: { state: 'closed', tabs: [] },
          },
        },
        id: 54,
      });
    });

    test('extension.getTabState handles empty states map', async () => {
      mockGetLastKnownStates.mockReturnValueOnce(new Map());

      handleServerMessage({ method: 'extension.getTabState', id: 55 });

      // Flush microtask queue — empty map triggers await loadLastKnownStateFromSession()
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSendToServer).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: { tabStates: {} },
        id: 55,
      });
    });

    test('extension.getTabState loads from session storage when in-memory map is empty on service worker wake', async () => {
      const sessionStates = new Map<string, string>([
        ['slack', JSON.stringify({ state: 'ready', tabs: [{ tabId: 1, url: 'https://slack.com' }] })],
      ]);
      // First call returns empty map (in-memory not yet restored after wake)
      mockGetLastKnownStates.mockReturnValueOnce(new Map());
      // After loadLastKnownStateFromSession resolves, second call returns populated map
      mockGetLastKnownStates.mockReturnValueOnce(sessionStates);

      handleServerMessage({ method: 'extension.getTabState', id: 56 });

      // Flush microtask queue to allow await loadLastKnownStateFromSession() to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(mockLoadLastKnownStateFromSession).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: {
          tabStates: {
            slack: { state: 'ready', tabs: [{ tabId: 1, url: 'https://slack.com' }] },
          },
        },
        id: 56,
      });
    });
  });

  describe('extension.reload routing', () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as {
      storage: { session: { set: ReturnType<typeof vi.fn> } };
      runtime: { reload: ReturnType<typeof vi.fn> };
    };
    const chromeSessionSet = chromeMock.storage.session.set;
    const chromeRuntimeReload = chromeMock.runtime.reload;

    beforeEach(() => {
      vi.useFakeTimers();
      chromeSessionSet.mockClear();
      chromeRuntimeReload.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('sends success result and calls chrome.runtime.reload() when id is provided', async () => {
      handleServerMessage({ method: 'extension.reload', id: 55 });

      expect(mockSendToServer).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: { reloading: true },
        id: 55,
      });

      expect(chromeSessionSet).toHaveBeenCalledTimes(1);
      expect(chromeSessionSet).toHaveBeenCalledWith({ wsConnected: false });

      // Flush the microtask queue so the .catch().then() chain fires and
      // schedules the setTimeout for chrome.runtime.reload()
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Advance past RELOAD_FLUSH_DELAY_MS (100ms)
      vi.advanceTimersByTime(100);
      expect(chromeRuntimeReload).toHaveBeenCalledTimes(1);
    });

    test('does not send a response when id is not provided', async () => {
      handleServerMessage({ method: 'extension.reload' });

      expect(mockSendToServer).not.toHaveBeenCalled();

      // Reload still happens even without an id
      expect(chromeSessionSet).toHaveBeenCalledTimes(1);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      vi.advanceTimersByTime(100);
      expect(chromeRuntimeReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('unrecognized method handling', () => {
    test('sends -32601 error response for unrecognized method with id', () => {
      handleServerMessage({ method: 'unknown.method', id: 99 });

      expect(mockSendToServer).toHaveBeenCalledTimes(1);
      expect(mockSendToServer).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found: unknown.method' },
        id: 99,
      });
    });

    test('does not send error for unrecognized method without id (notification)', () => {
      handleServerMessage({ method: 'unknown.notification' });

      expect(mockSendToServer).not.toHaveBeenCalled();
    });
  });

  describe('side panel forwarding', () => {
    test('does not forward tab.stateChanged via handleServerMessage (server never sends this method; the extension sends it directly via sendTabStateNotification)', () => {
      const message = {
        method: 'tab.stateChanged',
        params: {
          plugin: 'slack',
          state: 'ready',
          tabs: [{ tabId: 1, url: 'https://slack.com', title: 'Slack', ready: true }],
        },
      };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('forwards tool.invocationStart to side panel', () => {
      const message = {
        method: 'tool.invocationStart',
        params: { plugin: 'slack', tool: 'send-message' },
      };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
      expect(mockForwardToSidePanel).toHaveBeenCalledWith({
        type: 'sp:serverMessage',
        data: message,
      });
    });

    test('forwards tool.invocationEnd to side panel', () => {
      const message = {
        method: 'tool.invocationEnd',
        params: { plugin: 'slack', tool: 'send-message' },
      };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
      expect(mockForwardToSidePanel).toHaveBeenCalledWith({
        type: 'sp:serverMessage',
        data: message,
      });
    });

    test('forwards plugins.changed to side panel', () => {
      const message = { method: 'plugins.changed' };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
      expect(mockForwardToSidePanel).toHaveBeenCalledWith({
        type: 'sp:serverMessage',
        data: message,
      });
    });

    test('plugins.changed updates server state cache before forwarding to side panel', () => {
      const message = {
        method: 'plugins.changed',
        params: {
          plugins: [
            {
              name: 'test-plugin',
              displayName: 'Test Plugin',
              version: '1.0.0',
              permission: 'off',
              source: 'local',
              tabState: 'closed',
              urlPatterns: [],
              tools: [
                {
                  name: 'do-thing',
                  displayName: 'Do Thing',
                  description: 'Does a thing',
                  icon: 'wrench',
                  permission: 'auto',
                },
              ],
            },
          ],
          failedPlugins: [{ specifier: 'bad-plugin', error: 'load failed' }],
          browserTools: [{ name: 'browser_list_tabs', description: 'List tabs', permission: 'auto' }],
          serverVersion: '1.2.3',
        },
      };

      handleServerMessage(message);

      expect(mockUpdateServerStateCache).toHaveBeenCalledTimes(1);
      const cacheArg = mockUpdateServerStateCache.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(cacheArg).toBeDefined();
      expect(cacheArg.plugins).toHaveLength(1);
      expect(cacheArg.failedPlugins).toEqual([{ specifier: 'bad-plugin', error: 'load failed' }]);
      expect(cacheArg.browserTools).toEqual([
        { name: 'browser_list_tabs', description: 'List tabs', permission: 'auto' },
      ]);
      expect(cacheArg.serverVersion).toBe('1.2.3');

      // Verify cache update happens BEFORE side panel forwarding
      const cacheCallOrder = mockUpdateServerStateCache.mock.invocationCallOrder[0];
      const forwardCallOrder = mockForwardToSidePanel.mock.invocationCallOrder[0];
      expect(cacheCallOrder).toBeDefined();
      expect(forwardCallOrder).toBeDefined();
      expect(cacheCallOrder).toBeLessThan(forwardCallOrder as number);
    });

    test('does not forward sync.full to side panel', () => {
      handleServerMessage({
        method: 'sync.full',
        params: { plugins: [] },
      });

      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('does not forward tool.dispatch to side panel', () => {
      handleServerMessage({
        method: 'tool.dispatch',
        id: 50,
        params: { plugin: 'slack', tool: 'send-message', input: {} },
      });

      // tool.dispatch has a method, so isResponse is false.
      // tool.dispatch is not in SIDE_PANEL_METHODS, so it should not be forwarded.
      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('does not forward response messages (id without method) to side panel', () => {
      const message = { id: 100, result: { ok: true } };

      handleServerMessage(message);

      // Responses are consumed by server-request.ts, not forwarded to the side panel
      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });

    test('does not forward non-side-panel notification methods', () => {
      handleServerMessage({
        method: 'plugin.update',
        params: {
          name: 'test-plugin',
          version: '1.0.0',
          urlPatterns: [],
          tools: [],
        },
      });

      expect(mockForwardToSidePanel).not.toHaveBeenCalled();
    });
  });
});
