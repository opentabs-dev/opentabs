import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
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

// Stub chrome.browsingData API
const mockBrowsingDataRemove =
  vi.fn<(options: { origins: string[] }, dataToRemove: Record<string, boolean>) => Promise<void>>();

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    browsingData: {
      remove: mockBrowsingDataRemove,
    },
  },
});

// Import after mocking
const { handleBrowserClearSiteData } = await import('./browsing-data-commands.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getResult = () => mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserClearSiteData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowsingDataRemove.mockResolvedValue(undefined);
  });

  test('clears cookies and localStorage by default', async () => {
    await handleBrowserClearSiteData({ origin: 'https://example.com' }, 1);

    expect(mockBrowsingDataRemove).toHaveBeenCalledWith(
      { origins: ['https://example.com'] },
      {
        cookies: true,
        localStorage: true,
        cache: false,
        indexedDB: false,
        serviceWorkers: false,
      },
    );

    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as Record<string, unknown>;
    expect(result).toMatchObject({
      origin: 'https://example.com',
      cleared: {
        cookies: true,
        localStorage: true,
        cache: false,
        indexedDB: false,
        serviceWorkers: false,
      },
    });
  });

  test('selectively clears requested data types', async () => {
    await handleBrowserClearSiteData(
      {
        origin: 'https://example.com',
        cookies: false,
        localStorage: false,
        cache: true,
        indexedDB: true,
        serviceWorkers: true,
      },
      2,
    );

    expect(mockBrowsingDataRemove).toHaveBeenCalledWith(
      { origins: ['https://example.com'] },
      {
        cookies: false,
        localStorage: false,
        cache: true,
        indexedDB: true,
        serviceWorkers: true,
      },
    );
  });

  test('normalizes origin URL (strips path)', async () => {
    await handleBrowserClearSiteData({ origin: 'https://example.com/path/to/page' }, 3);

    expect(mockBrowsingDataRemove).toHaveBeenCalledWith({ origins: ['https://example.com'] }, expect.any(Object));
  });

  test('rejects missing origin', async () => {
    await handleBrowserClearSiteData({}, 4);

    expect(mockBrowsingDataRemove).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid origin parameter' }),
      id: 4,
    });
  });

  test('rejects empty origin', async () => {
    await handleBrowserClearSiteData({ origin: '' }, 5);

    expect(mockBrowsingDataRemove).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid origin parameter' }),
      id: 5,
    });
  });

  test('rejects invalid URL format', async () => {
    await handleBrowserClearSiteData({ origin: 'not-a-url' }, 6);

    expect(mockBrowsingDataRemove).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Invalid origin URL format' }),
      id: 6,
    });
  });

  test('sends error on failure', async () => {
    mockBrowsingDataRemove.mockRejectedValue(new Error('clear failed'));

    await handleBrowserClearSiteData({ origin: 'https://example.com' }, 7);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('clear failed') }),
      id: 7,
    });
  });
});
