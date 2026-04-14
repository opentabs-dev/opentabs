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

// Stub chrome.bookmarks API
const mockBookmarksSearch = vi.fn<(query: string) => Promise<chrome.bookmarks.BookmarkTreeNode[]>>();
const mockBookmarksCreate = vi.fn<(details: unknown) => Promise<chrome.bookmarks.BookmarkTreeNode>>();
const mockBookmarksGetTree = vi.fn<() => Promise<chrome.bookmarks.BookmarkTreeNode[]>>();
const mockBookmarksGetSubTree = vi.fn<(id: string) => Promise<chrome.bookmarks.BookmarkTreeNode[]>>();

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    bookmarks: {
      search: mockBookmarksSearch,
      create: mockBookmarksCreate,
      getTree: mockBookmarksGetTree,
      getSubTree: mockBookmarksGetSubTree,
    },
  },
});

// Import after mocking
const { handleBrowserSearchBookmarks, handleBrowserCreateBookmark, handleBrowserListBookmarkTree } = await import(
  './bookmark-commands.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeBookmarkNode = (
  overrides: Partial<chrome.bookmarks.BookmarkTreeNode> = {},
): chrome.bookmarks.BookmarkTreeNode =>
  ({
    id: '1',
    title: 'Example',
    url: 'https://example.com',
    parentId: '0',
    index: 0,
    dateAdded: 1713052800000,
    ...overrides,
  }) as chrome.bookmarks.BookmarkTreeNode;

const getResult = () => mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserSearchBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('searches bookmarks and returns results', async () => {
    mockBookmarksSearch.mockResolvedValue([
      makeBookmarkNode(),
      makeBookmarkNode({ id: '2', title: 'Test', url: 'https://test.com' }),
    ]);

    await handleBrowserSearchBookmarks({ query: 'example' }, 1);

    expect(mockBookmarksSearch).toHaveBeenCalledWith('example');
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as { bookmarks: Array<Record<string, unknown>> };
    expect(result.bookmarks).toHaveLength(2);
    expect(result.bookmarks[0]).toMatchObject({
      id: '1',
      title: 'Example',
      url: 'https://example.com',
      parentId: '0',
    });
    expect(result.bookmarks[0]?.dateAdded).toBe('2024-04-14T00:00:00.000Z');
  });

  test('rejects missing query', async () => {
    await handleBrowserSearchBookmarks({}, 2);

    expect(mockBookmarksSearch).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid query parameter' }),
      id: 2,
    });
  });

  test('rejects empty query', async () => {
    await handleBrowserSearchBookmarks({ query: '' }, 3);

    expect(mockBookmarksSearch).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid query parameter' }),
      id: 3,
    });
  });

  test('sends error on failure', async () => {
    mockBookmarksSearch.mockRejectedValue(new Error('bookmarks search failed'));

    await handleBrowserSearchBookmarks({ query: 'test' }, 4);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('bookmarks search failed') }),
      id: 4,
    });
  });
});

describe('handleBrowserCreateBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('creates a bookmark and returns the result', async () => {
    mockBookmarksCreate.mockResolvedValue(makeBookmarkNode({ id: '5', title: 'New', url: 'https://new.com' }));

    await handleBrowserCreateBookmark({ title: 'New', url: 'https://new.com' }, 1);

    expect(mockBookmarksCreate).toHaveBeenCalledWith({ title: 'New', url: 'https://new.com' });
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as Record<string, unknown>;
    expect(result).toMatchObject({
      id: '5',
      title: 'New',
      url: 'https://new.com',
    });
  });

  test('passes parentId when provided', async () => {
    mockBookmarksCreate.mockResolvedValue(makeBookmarkNode({ id: '6', parentId: '2' }));

    await handleBrowserCreateBookmark({ title: 'Test', url: 'https://test.com', parentId: '2' }, 2);

    expect(mockBookmarksCreate).toHaveBeenCalledWith({ title: 'Test', url: 'https://test.com', parentId: '2' });
  });

  test('rejects missing title', async () => {
    await handleBrowserCreateBookmark({ url: 'https://example.com' }, 3);

    expect(mockBookmarksCreate).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid title parameter' }),
      id: 3,
    });
  });

  test('rejects missing url', async () => {
    await handleBrowserCreateBookmark({ title: 'Test' }, 4);

    expect(mockBookmarksCreate).not.toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: 'Missing or invalid url parameter' }),
      id: 4,
    });
  });

  test('sends error on failure', async () => {
    mockBookmarksCreate.mockRejectedValue(new Error('create failed'));

    await handleBrowserCreateBookmark({ title: 'Test', url: 'https://test.com' }, 5);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('create failed') }),
      id: 5,
    });
  });
});

describe('handleBrowserListBookmarkTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns full tree with default max depth', async () => {
    mockBookmarksGetTree.mockResolvedValue([
      makeBookmarkNode({
        id: '0',
        title: '',
        url: undefined,
        children: [
          makeBookmarkNode({
            id: '1',
            title: 'Bookmarks Bar',
            url: undefined,
            children: [makeBookmarkNode({ id: '10', title: 'Example' })],
          }),
        ],
      }),
    ]);

    await handleBrowserListBookmarkTree({}, 1);

    expect(mockBookmarksGetTree).toHaveBeenCalled();
    const response = getResult();
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as { tree: Array<Record<string, unknown>> };
    expect(result.tree).toHaveLength(1);
    const root = result.tree[0] as Record<string, unknown>;
    expect(root.id).toBe('0');
    const children = root.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(1);
    expect(children[0]?.title).toBe('Bookmarks Bar');
  });

  test('uses getSubTree when parentId is provided', async () => {
    mockBookmarksGetSubTree.mockResolvedValue([
      makeBookmarkNode({
        id: '2',
        title: 'Folder',
        url: undefined,
        children: [makeBookmarkNode({ id: '20' })],
      }),
    ]);

    await handleBrowserListBookmarkTree({ parentId: '2' }, 2);

    expect(mockBookmarksGetSubTree).toHaveBeenCalledWith('2');
    expect(mockBookmarksGetTree).not.toHaveBeenCalled();
  });

  test('truncates tree beyond maxDepth', async () => {
    mockBookmarksGetTree.mockResolvedValue([
      makeBookmarkNode({
        id: '0',
        title: '',
        url: undefined,
        children: [
          makeBookmarkNode({
            id: '1',
            title: 'Folder',
            url: undefined,
            children: [makeBookmarkNode({ id: '10', title: 'Deep' })],
          }),
        ],
      }),
    ]);

    await handleBrowserListBookmarkTree({ maxDepth: 1 }, 3);

    const response = getResult();
    const result = response.result as { tree: Array<Record<string, unknown>> };
    const root = result.tree[0] as Record<string, unknown>;
    expect(root.childCount).toBe(1);
    expect(root.children).toBeUndefined();
  });

  test('sends error on failure', async () => {
    mockBookmarksGetTree.mockRejectedValue(new Error('tree failed'));

    await handleBrowserListBookmarkTree({}, 4);

    const response = getResult();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('tree failed') }),
      id: 4,
    });
  });
});
