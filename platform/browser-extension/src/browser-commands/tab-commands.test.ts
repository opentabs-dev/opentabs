import { beforeEach, describe, expect, test, vi } from 'vitest';

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

// Stub chrome APIs
const mockTabsQuery = vi.fn<() => Promise<chrome.tabs.Tab[]>>().mockResolvedValue([]);
const mockTabsCreate = vi.fn<(opts: unknown) => Promise<chrome.tabs.Tab>>().mockResolvedValue({} as chrome.tabs.Tab);
const mockTabsRemove = vi.fn<(tabId: number) => Promise<void>>().mockResolvedValue(undefined);
const mockTabsUpdate = vi
  .fn<(tabId: number, props: unknown) => Promise<chrome.tabs.Tab | undefined>>()
  .mockResolvedValue(undefined);
const mockTabsGet = vi.fn<(tabId: number) => Promise<chrome.tabs.Tab>>().mockResolvedValue({} as chrome.tabs.Tab);
const mockWindowsUpdate = vi.fn<(windowId: number, props: unknown) => Promise<void>>().mockResolvedValue(undefined);

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    runtime: { id: 'test-extension-id' },
    tabs: {
      query: mockTabsQuery,
      create: mockTabsCreate,
      remove: mockTabsRemove,
      update: mockTabsUpdate,
      get: mockTabsGet,
    },
    windows: { update: mockWindowsUpdate },
  },
});

// Import after mocking
const {
  handleBrowserOpenTab,
  handleBrowserCloseTab,
  handleBrowserNavigateTab,
  handleBrowserFocusTab,
  handleBrowserGetTabInfo,
} = await import('./tab-commands.js');

/** Extract the first argument from the first call to mockSendToServer */
const firstSentMessage = (): Record<string, unknown> => {
  const calls = mockSendToServer.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const firstCall = calls[0];
  if (!firstCall) throw new Error('Expected at least one call');
  return firstCall[0] as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// handleBrowserOpenTab
// ---------------------------------------------------------------------------

describe('handleBrowserOpenTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('opens blank tab when url is missing', async () => {
    mockTabsCreate.mockResolvedValueOnce({
      id: 99,
      title: '',
      url: 'chrome://newtab/',
      windowId: 1,
    } as chrome.tabs.Tab);
    await handleBrowserOpenTab({}, 'req-1');
    expect(mockTabsCreate).toHaveBeenCalledWith({});
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { id: 99 },
    });
  });

  test('opens blank tab when url is non-string', async () => {
    mockTabsCreate.mockResolvedValueOnce({
      id: 100,
      title: '',
      url: 'chrome://newtab/',
      windowId: 1,
    } as chrome.tabs.Tab);
    await handleBrowserOpenTab({ url: 42 }, 'req-2');
    expect(mockTabsCreate).toHaveBeenCalledWith({});
    expect(firstSentMessage()).toMatchObject({
      result: { id: 100 },
    });
  });

  test('rejects javascript: url', async () => {
    await handleBrowserOpenTab({ url: 'javascript:alert(1)' }, 'req-3');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects data: url', async () => {
    await handleBrowserOpenTab({ url: 'data:text/html,<h1>hi</h1>' }, 'req-4');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserCloseTab
// ---------------------------------------------------------------------------

describe('handleBrowserCloseTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserCloseTab({}, 'req-10');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-10',
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserCloseTab({ tabId: 'abc' }, 'req-11');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserNavigateTab
// ---------------------------------------------------------------------------

describe('handleBrowserNavigateTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserNavigateTab({ url: 'https://example.com' }, 'req-20');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects missing url', async () => {
    await handleBrowserNavigateTab({ tabId: 1 }, 'req-21');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid url parameter' },
    });
  });

  test('rejects blocked url scheme', async () => {
    await handleBrowserNavigateTab({ tabId: 1, url: 'file:///etc/passwd' }, 'req-22');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('returns requested url, not pre-navigation tab url', async () => {
    mockTabsUpdate.mockResolvedValueOnce({
      id: 42,
      title: 'Old Page',
      url: 'https://old.example.com',
    } as chrome.tabs.Tab);
    await handleBrowserNavigateTab({ tabId: 42, url: 'https://new.example.com' }, 'req-23');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-23',
      result: { id: 42, url: 'https://new.example.com' },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserFocusTab
// ---------------------------------------------------------------------------

describe('handleBrowserFocusTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserFocusTab({}, 'req-30');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserFocusTab({ tabId: true }, 'req-31');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserGetTabInfo
// ---------------------------------------------------------------------------

describe('handleBrowserGetTabInfo', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserGetTabInfo({}, 'req-40');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserGetTabInfo({ tabId: null }, 'req-41');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});
