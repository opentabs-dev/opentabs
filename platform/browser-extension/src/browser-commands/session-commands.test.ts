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

// Stub chrome.sessions API
const mockGetRecentlyClosed = vi.fn<(filter: { maxResults: number }) => Promise<chrome.sessions.Session[]>>();
const mockRestore = vi.fn<(sessionId: string) => Promise<chrome.sessions.Session>>();

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    sessions: {
      getRecentlyClosed: mockGetRecentlyClosed,
      restore: mockRestore,
    },
  },
});

// Import after mocking
const { handleBrowserGetRecentlyClosed, handleBrowserRestoreSession } = await import('./session-commands.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getResult = () => mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserGetRecentlyClosed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns recently closed tabs', async () => {
    mockGetRecentlyClosed.mockResolvedValue([
      {
        lastModified: 1713052800,
        tab: {
          sessionId: 'session-1',
          title: 'Example Page',
          url: 'https://example.com',
        },
      } as chrome.sessions.Session,
    ]);

    await handleBrowserGetRecentlyClosed({}, 1);

    expect(mockGetRecentlyClosed).toHaveBeenCalledWith({ maxResults: 25 });
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as { sessions: Array<Record<string, unknown>> };
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      type: 'tab',
      sessionId: 'session-1',
      title: 'Example Page',
      url: 'https://example.com',
    });
    expect(result.sessions[0]?.closedAt).toBe('2024-04-14T00:00:00.000Z');
  });

  test('returns recently closed windows', async () => {
    mockGetRecentlyClosed.mockResolvedValue([
      {
        lastModified: 1713052800,
        window: {
          sessionId: 'win-1',
          tabs: [{}, {}, {}],
        },
      } as chrome.sessions.Session,
    ]);

    await handleBrowserGetRecentlyClosed({}, 2);

    const response = getResult();
    const result = response.result as { sessions: Array<Record<string, unknown>> };
    expect(result.sessions[0]).toMatchObject({
      type: 'window',
      sessionId: 'win-1',
      tabCount: 3,
    });
  });

  test('respects maxResults parameter', async () => {
    mockGetRecentlyClosed.mockResolvedValue([]);

    await handleBrowserGetRecentlyClosed({ maxResults: 5 }, 3);

    expect(mockGetRecentlyClosed).toHaveBeenCalledWith({ maxResults: 5 });
  });

  test('defaults to 25 for invalid maxResults', async () => {
    mockGetRecentlyClosed.mockResolvedValue([]);

    await handleBrowserGetRecentlyClosed({ maxResults: -1 }, 4);

    expect(mockGetRecentlyClosed).toHaveBeenCalledWith({ maxResults: 25 });
  });

  test('sends error on failure', async () => {
    mockGetRecentlyClosed.mockRejectedValue(new Error('sessions failed'));

    await handleBrowserGetRecentlyClosed({}, 5);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('sessions failed') }),
      id: 5,
    });
  });
});

describe('handleBrowserRestoreSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('restores a tab session', async () => {
    mockRestore.mockResolvedValue({
      lastModified: 1713052800,
      tab: {
        id: 42,
        title: 'Restored Tab',
        url: 'https://example.com',
      },
    } as chrome.sessions.Session);

    await handleBrowserRestoreSession({ sessionId: 'session-1' }, 1);

    expect(mockRestore).toHaveBeenCalledWith('session-1');
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as Record<string, unknown>;
    expect(result).toMatchObject({
      type: 'tab',
      tabId: 42,
      title: 'Restored Tab',
      url: 'https://example.com',
    });
  });

  test('restores a window session', async () => {
    mockRestore.mockResolvedValue({
      lastModified: 1713052800,
      window: {
        id: 10,
        tabs: [{}, {}],
      },
    } as chrome.sessions.Session);

    await handleBrowserRestoreSession({ sessionId: 'win-1' }, 2);

    const response = getResult();
    const result = response.result as Record<string, unknown>;
    expect(result).toMatchObject({
      type: 'window',
      windowId: 10,
      tabCount: 2,
    });
  });

  test('rejects missing sessionId', async () => {
    await handleBrowserRestoreSession({}, 3);

    expect(mockRestore).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('Missing or invalid sessionId') }),
      id: 3,
    });
  });

  test('rejects empty sessionId', async () => {
    await handleBrowserRestoreSession({ sessionId: '' }, 4);

    expect(mockRestore).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('Missing or invalid sessionId') }),
      id: 4,
    });
  });

  test('sends error on failure', async () => {
    mockRestore.mockRejectedValue(new Error('restore failed'));

    await handleBrowserRestoreSession({ sessionId: 'session-1' }, 5);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('restore failed') }),
      id: 5,
    });
  });
});
