import { describe, expect, test, vi } from 'vitest';
import { ALL_ALLOWED_METHODS, DISPATCH_METHODS, PASSTHROUGH_METHODS } from './known-methods.js';

// ---------------------------------------------------------------------------
// Module mocks — message-router.ts imports many Chrome-API-dependent modules.
// Mock them so we can import methodHandlerNames without runtime errors.
// ---------------------------------------------------------------------------

const { asyncNoop } = vi.hoisted(() => ({
  asyncNoop: () => Promise.resolve(),
}));

vi.mock('./confirmation-badge.js', () => ({
  notifyConfirmationRequest: vi.fn(),
}));

vi.mock('./messaging.js', () => ({
  sendToServer: vi.fn(),
  forwardToSidePanel: vi.fn(),
  sendTabStateNotification: vi.fn(),
}));

vi.mock('./tool-dispatch.js', () => ({
  getPluginLink: vi.fn(),
  handleToolDispatch: vi.fn(),
  notifyDispatchProgress: vi.fn(),
}));

vi.mock('./browser-commands/index.js', () => ({
  handleBrowserListTabs: vi.fn(asyncNoop),
  handleBrowserOpenTab: vi.fn(asyncNoop),
  handleBrowserCloseTab: vi.fn(asyncNoop),
  handleBrowserNavigateTab: vi.fn(asyncNoop),
  handleBrowserFocusTab: vi.fn(asyncNoop),
  handleBrowserGetTabInfo: vi.fn(asyncNoop),
  handleBrowserListTabGroups: vi.fn(asyncNoop),
  handleBrowserCreateTabGroup: vi.fn(asyncNoop),
  handleBrowserAddTabsToGroup: vi.fn(asyncNoop),
  handleBrowserRemoveTabsFromGroup: vi.fn(asyncNoop),
  handleBrowserUpdateTabGroup: vi.fn(asyncNoop),
  handleBrowserListTabsInGroup: vi.fn(asyncNoop),
  handleBrowserGetTabContent: vi.fn(asyncNoop),
  handleBrowserGetPageHtml: vi.fn(asyncNoop),
  handleBrowserGetStorage: vi.fn(asyncNoop),
  handleBrowserScreenshotTab: vi.fn(asyncNoop),
  handleBrowserClickElement: vi.fn(asyncNoop),
  handleBrowserTypeText: vi.fn(asyncNoop),
  handleBrowserSelectOption: vi.fn(asyncNoop),
  handleBrowserWaitForElement: vi.fn(asyncNoop),
  handleBrowserQueryElements: vi.fn(asyncNoop),
  handleBrowserGetCookies: vi.fn(asyncNoop),
  handleBrowserSetCookie: vi.fn(asyncNoop),
  handleBrowserDeleteCookies: vi.fn(asyncNoop),
  handleBrowserEnableNetworkCapture: vi.fn(asyncNoop),
  handleBrowserGetNetworkRequests: vi.fn(asyncNoop),
  handleBrowserGetWebSocketFrames: vi.fn(asyncNoop),
  handleBrowserDisableNetworkCapture: vi.fn(asyncNoop),
  handleBrowserGetConsoleLogs: vi.fn(asyncNoop),
  handleBrowserClearConsoleLogs: vi.fn(asyncNoop),
  handleBrowserExecuteScript: vi.fn(asyncNoop),
  handleBrowserListResources: vi.fn(asyncNoop),
  handleBrowserGetResourceContent: vi.fn(asyncNoop),
  handleBrowserPressKey: vi.fn(asyncNoop),
  handleBrowserScroll: vi.fn(asyncNoop),
  handleBrowserHoverElement: vi.fn(asyncNoop),
  handleBrowserHandleDialog: vi.fn(asyncNoop),
  handleBrowserShowNotification: vi.fn(asyncNoop),
  handleBrowserListWindows: vi.fn(asyncNoop),
  handleBrowserCreateWindow: vi.fn(asyncNoop),
  handleBrowserUpdateWindow: vi.fn(asyncNoop),
  handleBrowserCloseWindow: vi.fn(asyncNoop),
  handleBrowserDownloadFile: vi.fn(asyncNoop),
  handleBrowserListDownloads: vi.fn(asyncNoop),
  handleBrowserGetDownloadStatus: vi.fn(asyncNoop),
  handleBrowserSearchHistory: vi.fn(asyncNoop),
  handleBrowserGetVisits: vi.fn(asyncNoop),
  handleBrowserSearchBookmarks: vi.fn(asyncNoop),
  handleBrowserCreateBookmark: vi.fn(asyncNoop),
  handleBrowserListBookmarkTree: vi.fn(asyncNoop),
  handleBrowserGetRecentlyClosed: vi.fn(asyncNoop),
  handleBrowserRestoreSession: vi.fn(asyncNoop),
  handleBrowserClearSiteData: vi.fn(asyncNoop),
  initNotificationClickHandler: vi.fn(),
  handleExtensionCheckAdapter: vi.fn(asyncNoop),
  handleExtensionForceReconnect: vi.fn(asyncNoop),
  handleExtensionGetState: vi.fn(asyncNoop),
  handleExtensionGetLogs: vi.fn(asyncNoop),
  handleExtensionGetSidePanel: vi.fn(asyncNoop),
}));

// Chrome API stubs needed by modules that message-router imports
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    session: { set: vi.fn(() => Promise.resolve()) },
  },
  runtime: { reload: vi.fn(), sendMessage: vi.fn(() => Promise.resolve()) },
  tabs: { query: vi.fn(() => Promise.resolve([])), onRemoved: { addListener: vi.fn() } },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: false }])),
    unregisterContentScripts: vi.fn(() => Promise.resolve()),
    registerContentScripts: vi.fn(() => Promise.resolve()),
  },
  windows: { getLastFocused: vi.fn(() => Promise.resolve({ id: 1 })) },
  debugger: { onEvent: { addListener: vi.fn() }, detach: vi.fn(() => Promise.resolve()) },
};

const { methodHandlerNames } = await import('./message-router.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('known-methods sync', () => {
  test('every methodHandler key is in DISPATCH_METHODS', () => {
    const dispatchSet = new Set<string>(DISPATCH_METHODS);
    const missing = methodHandlerNames.filter(name => !dispatchSet.has(name));
    expect(missing).toEqual([]);
  });

  test('every DISPATCH_METHODS entry exists in methodHandlers', () => {
    const handlerSet = new Set(methodHandlerNames);
    const missing = DISPATCH_METHODS.filter(name => !handlerSet.has(name));
    expect(missing).toEqual([]);
  });

  test('PASSTHROUGH_METHODS are NOT in methodHandlers', () => {
    const handlerSet = new Set(methodHandlerNames);
    const overlap = PASSTHROUGH_METHODS.filter(name => handlerSet.has(name));
    expect(overlap).toEqual([]);
  });

  test('ALL_ALLOWED_METHODS is the union of DISPATCH_METHODS and PASSTHROUGH_METHODS', () => {
    const expected = new Set([...DISPATCH_METHODS, ...PASSTHROUGH_METHODS]);
    const actual = new Set<string>(ALL_ALLOWED_METHODS);
    expect(actual).toEqual(expected);
  });

  test('no duplicate entries in ALL_ALLOWED_METHODS', () => {
    const unique = new Set<string>(ALL_ALLOWED_METHODS);
    expect(unique.size).toBe(ALL_ALLOWED_METHODS.length);
  });
});
