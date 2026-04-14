import { sendErrorResult, sendSuccessResult, sendValidationError } from './helpers.js';

/** Searches bookmarks by query string matching titles and URLs. */
export const handleBrowserSearchBookmarks = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const query = params.query;
    if (typeof query !== 'string' || query.length === 0) {
      sendValidationError(id, 'Missing or invalid query parameter');
      return;
    }

    const results = await chrome.bookmarks.search(query);

    const bookmarks = results.map(node => ({
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
    }));

    sendSuccessResult(id, { bookmarks });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Creates a new bookmark with the given title and URL. */
export const handleBrowserCreateBookmark = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const title = params.title;
    if (typeof title !== 'string' || title.length === 0) {
      sendValidationError(id, 'Missing or invalid title parameter');
      return;
    }

    const url = params.url;
    if (typeof url !== 'string' || url.length === 0) {
      sendValidationError(id, 'Missing or invalid url parameter');
      return;
    }

    const createDetails: chrome.bookmarks.CreateDetails = { title, url };

    if (typeof params.parentId === 'string' && params.parentId.length > 0) {
      createDetails.parentId = params.parentId;
    }

    const node = await chrome.bookmarks.create(createDetails);

    sendSuccessResult(id, {
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      index: node.index,
      dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Truncates a bookmark tree to a maximum depth. */
const truncateTree = (
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  maxDepth: number,
  currentDepth: number,
): Array<Record<string, unknown>> =>
  nodes.map(node => {
    const result: Record<string, unknown> = {
      id: node.id,
      title: node.title,
      dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
    };

    if (node.url) {
      result.url = node.url;
    }

    if (node.parentId) {
      result.parentId = node.parentId;
    }

    if (node.children) {
      if (currentDepth < maxDepth) {
        result.children = truncateTree(node.children, maxDepth, currentDepth + 1);
      } else {
        result.childCount = node.children.length;
      }
    }

    return result;
  });

/** Lists the bookmark tree, optionally starting from a specific parent node. */
export const handleBrowserListBookmarkTree = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const maxDepth =
      typeof params.maxDepth === 'number' && Number.isInteger(params.maxDepth) && params.maxDepth > 0
        ? params.maxDepth
        : 3;

    let tree: chrome.bookmarks.BookmarkTreeNode[];

    if (typeof params.parentId === 'string' && params.parentId.length > 0) {
      tree = await chrome.bookmarks.getSubTree(params.parentId);
    } else {
      tree = await chrome.bookmarks.getTree();
    }

    const truncated = truncateTree(tree, maxDepth, 1);

    sendSuccessResult(id, { tree: truncated });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
