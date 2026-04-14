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

// Stub chrome.downloads API
const mockDownloadsDownload = vi.fn<(options: unknown) => Promise<number>>();
const mockDownloadsSearch = vi.fn<(query: unknown) => Promise<chrome.downloads.DownloadItem[]>>();

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    downloads: {
      download: mockDownloadsDownload,
      search: mockDownloadsSearch,
    },
  },
});

// Import after mocking
const { handleBrowserDownloadFile, handleBrowserListDownloads, handleBrowserGetDownloadStatus } = await import(
  './download-commands.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDownloadItem = (overrides: Partial<chrome.downloads.DownloadItem> = {}): chrome.downloads.DownloadItem =>
  ({
    id: 1,
    url: 'https://example.com/file.txt',
    filename: '/path/to/file.txt',
    state: 'complete' as chrome.downloads.DownloadItem['state'],
    bytesReceived: 1024,
    totalBytes: 1024,
    startTime: '2026-04-14T00:00:00.000Z',
    endTime: '2026-04-14T00:00:01.000Z',
    ...overrides,
  }) as chrome.downloads.DownloadItem;

const getResult = () => mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserDownloadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('downloads a file and returns downloadId', async () => {
    mockDownloadsDownload.mockResolvedValue(42);

    await handleBrowserDownloadFile({ url: 'https://example.com/file.txt' }, 1);

    expect(mockDownloadsDownload).toHaveBeenCalledWith({
      url: 'https://example.com/file.txt',
      saveAs: false,
    });
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', result: { downloadId: 42 }, id: 1 });
  });

  test('passes filename and saveAs options', async () => {
    mockDownloadsDownload.mockResolvedValue(43);

    await handleBrowserDownloadFile({ url: 'https://example.com/file.txt', filename: 'custom.txt', saveAs: true }, 2);

    expect(mockDownloadsDownload).toHaveBeenCalledWith({
      url: 'https://example.com/file.txt',
      filename: 'custom.txt',
      saveAs: true,
    });
  });

  test('rejects missing url', async () => {
    await handleBrowserDownloadFile({}, 3);

    expect(mockDownloadsDownload).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid url parameter' }),
      id: 3,
    });
  });

  test('sends error on failure', async () => {
    mockDownloadsDownload.mockRejectedValue(new Error('download failed'));

    await handleBrowserDownloadFile({ url: 'https://example.com/file.txt' }, 4);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('download failed') }),
      id: 4,
    });
  });
});

describe('handleBrowserListDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns recent downloads with default limit', async () => {
    mockDownloadsSearch.mockResolvedValue([makeDownloadItem({ id: 1 }), makeDownloadItem({ id: 2 })]);

    await handleBrowserListDownloads({}, 1);

    expect(mockDownloadsSearch).toHaveBeenCalledWith({
      orderBy: ['-startTime'],
      limit: 20,
    });
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as { downloads: Array<Record<string, unknown>> };
    expect(result.downloads).toHaveLength(2);
    expect(result.downloads[0]).toMatchObject({ id: 1, state: 'complete' });
  });

  test('filters by query and state', async () => {
    mockDownloadsSearch.mockResolvedValue([makeDownloadItem()]);

    await handleBrowserListDownloads({ query: 'file.txt', state: 'complete', limit: 5 }, 2);

    expect(mockDownloadsSearch).toHaveBeenCalledWith({
      orderBy: ['-startTime'],
      query: ['file.txt'],
      state: 'complete',
      limit: 5,
    });
  });

  test('rejects invalid state', async () => {
    await handleBrowserListDownloads({ state: 'invalid' }, 3);

    expect(mockDownloadsSearch).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('Invalid state') }),
      id: 3,
    });
  });

  test('sends error on failure', async () => {
    mockDownloadsSearch.mockRejectedValue(new Error('search failed'));

    await handleBrowserListDownloads({}, 4);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('search failed') }),
      id: 4,
    });
  });
});

describe('handleBrowserGetDownloadStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns download status by id', async () => {
    mockDownloadsSearch.mockResolvedValue([makeDownloadItem({ id: 42 })]);

    await handleBrowserGetDownloadStatus({ downloadId: 42 }, 1);

    expect(mockDownloadsSearch).toHaveBeenCalledWith({ id: 42 });
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      result: { id: 42, state: 'complete', bytesReceived: 1024, totalBytes: 1024 },
      id: 1,
    });
  });

  test('rejects missing downloadId', async () => {
    await handleBrowserGetDownloadStatus({}, 2);

    expect(mockDownloadsSearch).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid downloadId parameter' }),
      id: 2,
    });
  });

  test('returns error when download not found', async () => {
    mockDownloadsSearch.mockResolvedValue([]);

    await handleBrowserGetDownloadStatus({ downloadId: 999 }, 3);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Download with id 999 not found' }),
      id: 3,
    });
  });

  test('sends error on failure', async () => {
    mockDownloadsSearch.mockRejectedValue(new Error('api error'));

    await handleBrowserGetDownloadStatus({ downloadId: 1 }, 4);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('api error') }),
      id: 4,
    });
  });
});
