import { ALL_ALLOWED_METHODS, DISPATCH_METHODS, PASSTHROUGH_METHODS } from './known-methods.js';
import { describe, expect, test, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — message-router.ts imports many Chrome-API-dependent modules.
// Mock them so we can import methodHandlerNames without runtime errors.
// ---------------------------------------------------------------------------

await mock.module('./messaging.js', () => ({
  sendToServer: mock(),
  forwardToSidePanel: mock(),
}));

await mock.module('./tool-dispatch.js', () => ({
  handleToolDispatch: mock(),
}));

const asyncNoop = () => Promise.resolve();

await mock.module('./browser-commands.js', () => ({
  handleBrowserListTabs: mock(asyncNoop),
  handleBrowserOpenTab: mock(asyncNoop),
  handleBrowserCloseTab: mock(asyncNoop),
  handleBrowserNavigateTab: mock(asyncNoop),
  handleBrowserFocusTab: mock(asyncNoop),
  handleBrowserGetTabInfo: mock(asyncNoop),
  handleBrowserGetTabContent: mock(asyncNoop),
  handleBrowserGetPageHtml: mock(asyncNoop),
  handleBrowserGetStorage: mock(asyncNoop),
  handleBrowserScreenshotTab: mock(asyncNoop),
  handleBrowserClickElement: mock(asyncNoop),
  handleBrowserTypeText: mock(asyncNoop),
  handleBrowserSelectOption: mock(asyncNoop),
  handleBrowserWaitForElement: mock(asyncNoop),
  handleBrowserQueryElements: mock(asyncNoop),
  handleBrowserGetCookies: mock(asyncNoop),
  handleBrowserSetCookie: mock(asyncNoop),
  handleBrowserDeleteCookies: mock(asyncNoop),
  handleBrowserEnableNetworkCapture: mock(asyncNoop),
  handleBrowserGetNetworkRequests: mock(asyncNoop),
  handleBrowserDisableNetworkCapture: mock(asyncNoop),
  handleBrowserGetConsoleLogs: mock(asyncNoop),
  handleBrowserClearConsoleLogs: mock(asyncNoop),
  handleBrowserExecuteScript: mock(asyncNoop),
  handleBrowserListResources: mock(asyncNoop),
  handleBrowserGetResourceContent: mock(asyncNoop),
  handleBrowserPressKey: mock(asyncNoop),
  handleBrowserScroll: mock(asyncNoop),
  handleBrowserHoverElement: mock(asyncNoop),
  handleBrowserHandleDialog: mock(asyncNoop),
  handleExtensionCheckAdapter: mock(asyncNoop),
  handleExtensionGetState: mock(asyncNoop),
  handleExtensionGetLogs: mock(asyncNoop),
  handleExtensionGetSidePanel: mock(asyncNoop),
}));

// Chrome API stubs needed by modules that message-router imports
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: { get: mock(() => Promise.resolve({})), set: mock(() => Promise.resolve()) },
    session: { set: mock(() => Promise.resolve()) },
  },
  runtime: { reload: mock(), sendMessage: mock(() => Promise.resolve()) },
  tabs: { query: mock(() => Promise.resolve([])) },
  scripting: {
    executeScript: mock(() => Promise.resolve([{ result: false }])),
    unregisterContentScripts: mock(() => Promise.resolve()),
    registerContentScripts: mock(() => Promise.resolve()),
  },
  windows: { getLastFocused: mock(() => Promise.resolve({ id: 1 })) },
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
