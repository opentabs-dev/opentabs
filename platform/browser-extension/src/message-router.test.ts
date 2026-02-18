import { mock, describe, expect, test, beforeEach } from 'bun:test';
import type { ValidatedPluginPayload } from './message-router.js';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing message-router.js so that
// handleServerMessage's internal references bind to the mocked versions.
//
// Only mock modules that have NO separate test file in this directory.
// Modules with their own test files (plugin-storage, tab-matching) are NOT
// mocked here to avoid contaminating their tests when Bun runs all test
// files in the same process.
// ---------------------------------------------------------------------------

const mockSendToServer = mock<(data: unknown) => void>();
const mockForwardToSidePanel = mock<(message: unknown) => void>();

const asyncNoop = () => Promise.resolve();
const mockHandleToolDispatch = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);

const mockHandleBrowserListTabs = mock(asyncNoop as (id: string | number) => Promise<void>);
const mockHandleBrowserOpenTab = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserCloseTab = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserNavigateTab = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserFocusTab = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserGetTabInfo = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserGetTabContent = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserScreenshotTab = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserClickElement = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserTypeText = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserSelectOption = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserWaitForElement = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserQueryElements = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserGetCookies = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserSetCookie = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserDeleteCookies = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);
const mockHandleBrowserExecuteScript = mock(
  asyncNoop as (params: Record<string, unknown>, id: string | number) => Promise<void>,
);

await mock.module('./messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: mockForwardToSidePanel,
}));

await mock.module('./tool-dispatch.js', () => ({
  handleToolDispatch: mockHandleToolDispatch,
}));

await mock.module('./browser-commands.js', () => ({
  handleBrowserListTabs: mockHandleBrowserListTabs,
  handleBrowserOpenTab: mockHandleBrowserOpenTab,
  handleBrowserCloseTab: mockHandleBrowserCloseTab,
  handleBrowserNavigateTab: mockHandleBrowserNavigateTab,
  handleBrowserFocusTab: mockHandleBrowserFocusTab,
  handleBrowserGetTabContent: mockHandleBrowserGetTabContent,
  handleBrowserGetTabInfo: mockHandleBrowserGetTabInfo,
  handleBrowserScreenshotTab: mockHandleBrowserScreenshotTab,
  handleBrowserClickElement: mockHandleBrowserClickElement,
  handleBrowserTypeText: mockHandleBrowserTypeText,
  handleBrowserSelectOption: mockHandleBrowserSelectOption,
  handleBrowserWaitForElement: mockHandleBrowserWaitForElement,
  handleBrowserQueryElements: mockHandleBrowserQueryElements,
  handleBrowserGetCookies: mockHandleBrowserGetCookies,
  handleBrowserSetCookie: mockHandleBrowserSetCookie,
  handleBrowserDeleteCookies: mockHandleBrowserDeleteCookies,
  handleBrowserExecuteScript: mockHandleBrowserExecuteScript,
}));

// Chrome API stubs for modules that are NOT mocked (plugin-storage, iife-injection,
// tab-state). These real modules call Chrome APIs internally, so stubs prevent
// runtime errors when async handlers fire during routing tests.
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: mock(() => Promise.resolve({})),
      set: mock(() => Promise.resolve()),
    },
    session: {
      set: mock(() => Promise.resolve()),
    },
  },
  runtime: {
    reload: mock(),
    sendMessage: mock(() => Promise.resolve()),
  },
  tabs: {
    query: mock(() => Promise.resolve([])),
  },
  scripting: {
    executeScript: mock(() => Promise.resolve([{ result: false }])),
    unregisterContentScripts: mock(() => Promise.resolve()),
    registerContentScripts: mock(() => Promise.resolve()),
  },
  windows: {
    getLastFocused: mock(() => Promise.resolve({ id: 1 })),
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
  tools: [{ name: 'do-thing', description: 'Does a thing', enabled: true }],
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
        trustTier: 'official',
      });
      expect(result.displayName).toBe('Test Plugin');
      expect(result.sourcePath).toBe('/some/path');
      expect(result.adapterHash).toBe('abc123');
      expect(result.trustTier).toBe('official');
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
        { name: 'tool-a', description: 'Tool A', enabled: true },
        { name: 'tool-b', description: 'Tool B', enabled: false },
      ];
      const result = expectValid({ ...validPayload(), tools });
      expect(result.tools).toHaveLength(2);
      const firstTool = result.tools[0];
      expect(firstTool).toBeDefined();
      expect((firstTool as NonNullable<typeof firstTool>).name).toBe('tool-a');
      const secondTool = result.tools[1];
      expect(secondTool).toBeDefined();
      expect((secondTool as NonNullable<typeof secondTool>).enabled).toBe(false);
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
          { description: 'No name', enabled: true },
          { name: 'valid', description: 'Has name', enabled: true },
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
          { name: 'no-desc', enabled: true },
          { name: 'valid', description: 'Has desc', enabled: true },
        ],
      });
      expect(result.tools).toHaveLength(1);
    });

    test('filters out tools missing enabled flag', () => {
      const result = expectValid({
        ...validPayload(),
        tools: [
          { name: 'no-enabled', description: 'Missing enabled' },
          { name: 'valid', description: 'Has enabled', enabled: false },
        ],
      });
      expect(result.tools).toHaveLength(1);
      const enabledTool = result.tools[0];
      expect(enabledTool).toBeDefined();
      expect((enabledTool as NonNullable<typeof enabledTool>).name).toBe('valid');
    });

    test('filters out non-object tool entries', () => {
      const result = expectValid({
        ...validPayload(),
        tools: ['not-an-object', null, 42, { name: 'valid', description: 'OK', enabled: true }],
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

    test('defaults trustTier to local when missing', () => {
      const result = expectValid(validPayload());
      expect(result.trustTier).toBe('local');
    });

    test('defaults trustTier to local for invalid value', () => {
      const result = expectValid({ ...validPayload(), trustTier: 'invalid' });
      expect(result.trustTier).toBe('local');
    });

    test('accepts official trustTier', () => {
      expect(expectValid({ ...validPayload(), trustTier: 'official' }).trustTier).toBe('official');
    });

    test('accepts community trustTier', () => {
      expect(expectValid({ ...validPayload(), trustTier: 'community' }).trustTier).toBe('community');
    });

    test('accepts local trustTier', () => {
      expect(expectValid({ ...validPayload(), trustTier: 'local' }).trustTier).toBe('local');
    });

    test('displayName is undefined when missing', () => {
      expect(expectValid(validPayload()).displayName).toBeUndefined();
    });

    test('displayName is undefined when non-string', () => {
      expect(expectValid({ ...validPayload(), displayName: 42 }).displayName).toBeUndefined();
    });

    test('sourcePath is undefined when missing', () => {
      expect(expectValid(validPayload()).sourcePath).toBeUndefined();
    });

    test('adapterHash is undefined when missing', () => {
      expect(expectValid(validPayload()).adapterHash).toBeUndefined();
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
  mockHandleBrowserScreenshotTab.mockReset();
  mockHandleBrowserClickElement.mockReset();
  mockHandleBrowserTypeText.mockReset();
  mockHandleBrowserSelectOption.mockReset();
  mockHandleBrowserWaitForElement.mockReset();
  mockHandleBrowserQueryElements.mockReset();
  mockHandleBrowserGetCookies.mockReset();
  mockHandleBrowserSetCookie.mockReset();
  mockHandleBrowserDeleteCookies.mockReset();
  mockHandleBrowserExecuteScript.mockReset();
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
    mockHandleBrowserScreenshotTab.mockResolvedValue(undefined);
    mockHandleBrowserClickElement.mockResolvedValue(undefined);
    mockHandleBrowserTypeText.mockResolvedValue(undefined);
    mockHandleBrowserSelectOption.mockResolvedValue(undefined);
    mockHandleBrowserWaitForElement.mockResolvedValue(undefined);
    mockHandleBrowserQueryElements.mockResolvedValue(undefined);
    mockHandleBrowserGetCookies.mockResolvedValue(undefined);
    mockHandleBrowserSetCookie.mockResolvedValue(undefined);
    mockHandleBrowserDeleteCookies.mockResolvedValue(undefined);
    mockHandleBrowserExecuteScript.mockResolvedValue(undefined);
  });

  describe('sync.full routing', () => {
    test('dispatches sync.full to the internal handler without error', () => {
      // sync.full triggers handleSyncFull which calls plugin-storage and
      // iife-injection internally. The handler runs asynchronously via
      // .catch(console.error), so we verify it doesn't produce a -32601 error.
      handleServerMessage({
        method: 'sync.full',
        params: {
          plugins: [
            {
              name: 'test-plugin',
              version: '1.0.0',
              urlPatterns: ['*://example.com/*'],
              tools: [{ name: 'do-thing', description: 'Does a thing', enabled: true }],
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
  });

  describe('plugin.update routing', () => {
    test('dispatches plugin.update to the internal handler without error', () => {
      handleServerMessage({
        method: 'plugin.update',
        params: {
          name: 'test-plugin',
          version: '2.0.0',
          urlPatterns: ['*://example.com/*'],
          tools: [{ name: 'do-thing', description: 'Does a thing', enabled: true }],
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

    test('does not dispatch plugin.uninstall without an id', () => {
      handleServerMessage({
        method: 'plugin.uninstall',
        params: { name: 'test-plugin' },
      });

      // Without id, the handler guard prevents execution — no error sent
      expect(mockSendToServer).not.toHaveBeenCalled();
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

    test('dispatches browser.executeScript to handleBrowserExecuteScript', () => {
      handleServerMessage({
        method: 'browser.executeScript',
        id: 24,
        params: { tabId: 7, code: 'return 1' },
      });

      expect(mockHandleBrowserExecuteScript).toHaveBeenCalledTimes(1);
      expect(mockHandleBrowserExecuteScript).toHaveBeenCalledWith({ tabId: 7, code: 'return 1' }, 24);
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
    test('forwards tab.stateChanged to side panel', () => {
      const message = {
        method: 'tab.stateChanged',
        params: { plugin: 'slack', state: 'ready', tabId: 1, url: 'https://slack.com' },
      };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
      expect(mockForwardToSidePanel).toHaveBeenCalledWith({
        type: 'sp:serverMessage',
        data: message,
      });
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

    test('forwards response messages (id without method) to side panel', () => {
      const message = { id: 100, result: { ok: true } };

      handleServerMessage(message);

      expect(mockForwardToSidePanel).toHaveBeenCalledTimes(1);
      expect(mockForwardToSidePanel).toHaveBeenCalledWith({
        type: 'sp:serverMessage',
        data: message,
      });
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
