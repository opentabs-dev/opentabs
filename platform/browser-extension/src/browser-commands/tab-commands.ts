import { requireTabId, requireUrl, sendErrorResult, sendSuccessResult, sendValidationError } from './helpers.js';

/** Lists all open Chrome tabs with their IDs, URLs, titles, active state, and window IDs. */
export const handleBrowserListTabs = async (id: string | number): Promise<void> => {
  try {
    const tabs = await chrome.tabs.query({});
    const result = tabs.map(tab => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: tab.active,
      windowId: tab.windowId,
    }));
    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Opens a new Chrome tab with the specified URL.
 * @param params - Expects `{ url: string }`. Rejects blocked URL schemes (javascript:, data:, etc.)
 *   but allows `about:blank` for internal callers (e.g., analyze-site) that need a blank tab
 *   for network capture setup before navigating to the real URL.
 * @returns The new tab's ID, title, URL, and window ID.
 */
export const handleBrowserOpenTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const rawUrl = params.url;
    let url: string;
    if (typeof rawUrl === 'string' && rawUrl === 'about:blank') {
      url = rawUrl;
    } else {
      const validated = requireUrl(params, id);
      if (validated === null) return;
      url = validated;
    }
    const tab = await chrome.tabs.create({ url });
    sendSuccessResult(id, { id: tab.id, title: tab.title ?? '', url: tab.url ?? url, windowId: tab.windowId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Closes a Chrome tab by its ID.
 * @param params - Expects `{ tabId: number }`.
 * @returns `{ ok: true }` on success.
 */
export const handleBrowserCloseTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    await chrome.tabs.remove(tabId);
    sendSuccessResult(id, { ok: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Navigates an existing tab to a new URL.
 * @param params - Expects `{ tabId: number, url: string }`. Rejects blocked URL schemes.
 * @returns The tab's ID, title, and navigated URL.
 */
export const handleBrowserNavigateTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const url = requireUrl(params, id);
    if (url === null) return;
    const tab = await chrome.tabs.update(tabId, { url });
    sendSuccessResult(id, { id: tab?.id ?? tabId, title: tab?.title ?? '', url });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Activates a tab and brings its window to the foreground.
 * @param params - Expects `{ tabId: number }`.
 * @returns The focused tab's ID, title, URL, and active state.
 */
export const handleBrowserFocusTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) {
      sendValidationError(id, `Tab ${tabId} not found`);
      return;
    }
    await chrome.windows.update(tab.windowId, { focused: true });
    sendSuccessResult(id, { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', active: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Retrieves detailed metadata for a single tab including status, favicon URL, and incognito state.
 * @param params - Expects `{ tabId: number }`.
 * @returns Tab metadata: ID, title, URL, status, active, windowId, favIconUrl, and incognito.
 */
export const handleBrowserGetTabInfo = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const tab = await chrome.tabs.get(tabId);
    sendSuccessResult(id, {
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      status: tab.status ?? '',
      active: tab.active,
      windowId: tab.windowId,
      favIconUrl: tab.favIconUrl ?? '',
      incognito: tab.incognito,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
